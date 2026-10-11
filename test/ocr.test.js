import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { mergePdf } from '../src/pdf.js';
import { createOcr } from '../src/ocr.js';

async function readPdf(file, render = false) {
  const document = await getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true }).promise;
  try {
    const page = await document.getPage(1);
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
    let pixels;
    if (render) {
      const viewport = page.getViewport({ scale: 1 }), canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    return { text, pixels };
  } finally { await document.destroy(); }
}

test('OCR locale reale: testo ricercabile, aspetto identico, cache e annullamento', async () => {
  await mkdir('tmp/ocr-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/ocr-tests/run-'));
  const browser = await chromium.launch({ headless: true });
  let png;
  try {
    const page = await browser.newPage();
    png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 450;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 450);
      ctx.fillStyle = 'black'; ctx.font = '48px Arial'; ctx.fillText('Ciao mondo. Libro italiano.', 50, 100); ctx.fillText('Hello world. Searchable PDF.', 50, 190);
      return [...Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0))];
    }));
  } finally { await browser.close(); }
  const image = path.join(root, '000001.png'); await writeFile(image, png);
  const book = { id: 'OCR_TEST', title: 'Prova OCR', provider: 'mydbook', pages: [{ id: '1' }] };
  const plain = await mergePdf(book, [image], { quiet: true, outputDir: root });
  const events = [];
  const recognized = await mergePdf(book, [image], { quiet: true, ocr: true, outputDir: root, onProgress: event => events.push(event) });
  const baseline = await readPdf(plain, true), result = await readPdf(recognized, true);
  assert.match(result.text, /Ciao mondo/); assert.match(result.text, /Hello world/);
  assert.deepEqual(result.pixels, baseline.pixels, 'Lo strato OCR deve essere invisibile');
  assert.equal(baseline.text, '');
  assert.deepEqual((await PDFDocument.load(await readFile(recognized))).getPage(0).getSize(), { width: 1000, height: 450 });
  assert.ok(events.some(event => event.phase === 'ocr' && event.completed === 1));
  assert.match(recognized, /-ocr\.pdf$/);
  const cacheFile = (await readdir(root)).find(file => /\.ocr-ita-eng-v1-.*\.pdf$/.test(file));
  assert.ok(cacheFile);
  const before = await readFile(path.join(root, cacheFile));
  const modified = (await stat(path.join(root, cacheFile))).mtimeMs;
  await mergePdf(book, [image], { quiet: true, ocr: true, outputDir: root });
  assert.deepEqual(await readFile(path.join(root, cacheFile)), before);
  assert.equal((await stat(path.join(root, cacheFile))).mtimeMs, modified, 'Il risultato OCR valido va riutilizzato');
  assert.deepEqual(await readFile(image), png);
  const controller = new AbortController(); controller.abort();
  const recognition = createOcr({ signal: controller.signal });
  await assert.rejects(recognition.recognize(png, image, 0, 1), /interrotto/); await recognition.close();
  const activeController = new AbortController(), active = createOcr({ signal: activeController.signal });
  await active.recognize(png, path.join(root, 'warmup.png'), 0, 1);
  const pending = active.recognize(png, path.join(root, 'cancel.png'), 0, 1);
  const timer = setTimeout(() => activeController.abort(), 20);
  try { await assert.rejects(pending, /interrotto/); } finally { clearTimeout(timer); await active.close(); }
  const smart = await mergePdf({ ...book, provider: 'bsmart', title: 'bSmart' }, [plain], { quiet: true, ocr: true, outputDir: root });
  assert.equal((await readPdf(smart)).text, ''); assert.equal(path.basename(smart), 'bSmart.pdf');
});
