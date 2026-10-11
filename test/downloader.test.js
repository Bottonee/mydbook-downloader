import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { Api } from '../src/api.js';
import { config } from '../src/config.js';
import { downloadPages, pageFilename } from '../src/books.js';
import { closeImages, imageToJpeg } from '../src/images.js';
import { mergePdf, sanitizeTitle } from '../src/pdf.js';

test('retry 500, errore 401 senza retry e credenziali limitate al sito', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fake-test-token');
    calls++;
    return new Response(calls === 1 ? '' : '{"ok":true}', { status: calls === 1 ? 500 : 200 });
  };
  try {
    const api = new Api('fake-test-token');
    assert.deepEqual(await api.json('/test'), { ok: true });
    assert.equal(calls, 2);
    await assert.rejects(api.request('https://example.com/page'), /Host/);
    assert.equal(calls, 2);
    globalThis.fetch = async () => { calls++; return new Response('', { status: 401 }); };
    await assert.rejects(api.request('/test'), /Token scaduto/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = previous; }
});

test('concorrenza, ripresa, riparazione di pagine corrotte e ordine/dimensioni PDF', async () => {
  await mkdir(config.tmpDir, { recursive: true });
  const temp = await mkdtemp(path.join(path.resolve(config.tmpDir), 'test-'));
  const id = path.basename(temp);
  const browser = await chromium.launch();
  let images;
  try {
    const page = await browser.newPage();
    images = await page.evaluate(() => [[17, 23], [41, 13]].map(([w, h], i) => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d'); context.fillStyle = i ? 'blue' : 'red'; context.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png').split(',')[1];
    }));
  } finally { await browser.close(); }
  const book = { id, title: id, pages: ['9', '2', 'copertina', '100', '3', '4'].map(id => ({ id })) };
  let active = 0, peak = 0, requests = 0;
  const api = {
    async json(url) {
      requests++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 100)); active--;
      const id = decodeURIComponent(url.split('/').at(-1));
      return { pages: [{ id, url: `https://mydbook.olhos.it/test/${id}` }] };
    },
    async request(url) { return Buffer.from(images[url.endsWith('/2') ? 1 : 0], 'base64'); },
  };
  try {
    const files = await downloadPages(api, book, { quiet: true });
    assert.equal(requests, 6); assert.ok(peak > 1 && peak <= 4);
    requests = 0;
    await downloadPages(api, book, { quiet: true });
    assert.equal(requests, 0);
    await writeFile(files[2], 'immagine troncata');
    await downloadPages(api, book, { quiet: true });
    assert.equal(requests, 1);
    assert.deepEqual(files.map(f => path.basename(f)), book.pages.map((_, i) => pageFilename(i)));
    const target = await mergePdf(book, files, { quiet: true });
    const pdf = await PDFDocument.load(await readFile(target));
    assert.equal(pdf.getPageCount(), 6);
    assert.deepEqual(pdf.getPages().map(p => [p.getWidth(), p.getHeight()]), [[17, 23], [41, 13], [17, 23], [17, 23], [17, 23], [17, 23]]);
    await assert.rejects(mergePdf(book, files.slice(1)), /Pagine mancanti/);
    assert.equal(sanitizeTitle('CON'), '_CON');
    assert.equal(sanitizeTitle('a/b:c'), 'a_b_c');
  } finally { await closeImages(); }
});

test('compressione JPEG: qualità, dimensioni, sfondo bianco e originali invariati', async () => {
  await mkdir(config.tmpDir, { recursive: true });
  const folder = await mkdtemp(path.join(path.resolve(config.tmpDir), 'test-compression-'));
  const browser = await chromium.launch();
  let png;
  try {
    const page = await browser.newPage();
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(320, 400);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + c] = seed >>> 24; }
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      context.clearRect(0, 0, 20, 20);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    png = Buffer.from(base64, 'base64');
    assert.throws(() => imageToJpeg(png, 0), /tra 1 e 100/);
    assert.throws(() => imageToJpeg(png, 101), /tra 1 e 100/);
    const jpeg = await imageToJpeg(png, 80);
    const corner = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(0, 0, 1, 1).data];
    }, jpeg.toString('base64'));
    assert.ok(corner.slice(0, 3).every(c => c >= 250)); assert.equal(corner[3], 255);
  } finally { await browser.close(); }
  try {
    const file = path.join(folder, '000001.png'); await writeFile(file, png);
    const book = { id: path.basename(folder), title: path.basename(folder), pages: [{ id: 'copertina' }] };
    const original = await mergePdf(book, [file], { quiet: true });
    const small = await mergePdf(book, [file], { compress: true, quality: 40, quiet: true });
    const high = await mergePdf(book, [file], { compress: true, quality: 90, quiet: true });
    const smallBytes = await readFile(small);
    assert.ok(smallBytes.length < (await readFile(high)).length);
    assert.ok(smallBytes.length < (await readFile(original)).length);
    assert.ok(smallBytes.includes(Buffer.from('/DCTDecode')));
    const pdf = await PDFDocument.load(smallBytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.deepEqual([pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()], [320, 400]);
    assert.deepEqual(await readFile(file), png);
    assert.notEqual(small, original);
  } finally { await closeImages(); }
});
