import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePages, printedNumber, selectPages } from '../src/page-selection.js';
import { downloadBook } from '../src/download.js';
import { mydbookMetadata } from '../src/providers/mydbook.js';

test('pagine singole e intervalli: spazi, duplicati, ordine e input non validi', () => {
  assert.deepEqual(parsePages('4, 1, 2, 17- 25, 2, 19-20'), [1, 2, 4, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  assert.equal(parsePages('  '), null);
  for (const expression of ['0', '-1', '2-1', '1,', '1,,2', '1.5', '1-3-4', 'abc', '1-999999999']) assert.throws(() => parsePages(expression));
  assert.equal(printedNumber('Pagina 17'), 17); assert.equal(printedNumber('17'), 17);
  assert.equal(printedNumber('IV'), null); assert.equal(printedNumber('Indice'), null);
});

test('numerazione stampata: pagine romane escluse, nessuna deduzione dagli ID e calibrazione esplicita', () => {
  const pages = ['I', 'II', 'III', '1', '2', '3', '4'].map((label, i) => ({ id: String(i + 100), label }));
  const selection = selectPages(pages, '1, 3-4');
  assert.deepEqual(selection.indices, [3, 5, 6]); assert.deepEqual(selection.pages.map(p => p.label), ['1', '3', '4']);
  assert.throws(() => selectPages(pages.map(p => ({ id: p.id })), '1'), /Calibra|calibra/);
  assert.deepEqual(selectPages(pages.map(p => ({ id: p.id })), '1, 3-4', { firstDigitalPage: 4 }).indices, [3, 5, 6]);
  assert.deepEqual(selectPages(pages, '17-18', { firstDigitalPage: 5, firstBookPage: 17 }).indices, [4, 5]);
  assert.throws(() => selectPages([...pages, { id: 'other', label: '1' }], '1'), /ambigua/);
  assert.throws(() => selectPages(pages, '99'), /non disponibile/);
  assert.throws(() => selectPages(pages, '1', { firstDigitalPage: 100 }), /Calibrazione/);
});

test('download selettivo: soltanto pagine richieste, cache condivisa, ordine e PageLabels originali', async () => {
  await mkdir('tmp/page-selection-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/page-selection-tests/run-'));
  const previous = globalThis.fetch;
  const labels = ['I', 'II', '1', '2', '3', '4'];
  const assets = await Promise.all(labels.map(async (_, i) => { const pdf = await PDFDocument.create(); pdf.addPage([200 + i, 300 + i]); return Buffer.from(await pdf.save()); }));
  const requested = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.hostname === 'cdn.example') { const i = Number(u.pathname.slice(1)); requested.push(i); return new Response(assets[i]); }
    if (u.pathname.includes('by_book_id')) return new Response(JSON.stringify({ id: 42, title: 'Libro selettivo', current_edition: { revision: 7 } }));
    return new Response(JSON.stringify(labels.map((title, i) => ({ title, assets: [{ id: i + 200, use: 'page_pdf', url: `https://cdn.example/${i}`, encrypted: false }] }))));
  };
  try {
    const options = { provider: 'bsmart', token: 'fixture', book: { id: '42', title: 'Libro selettivo' }, tmpDir: path.join(root, 'tmp'), outputDir: path.join(root, 'output'), quiet: true };
    const events = [];
    const target = await downloadBook({ ...options, pageSelection: '1, 3', onProgress: event => events.push(event) });
    assert.deepEqual(requested.sort(), [2, 4]); assert.match(target, /-pagine-1_3\.pdf$/);
    const pdf = await PDFDocument.load(await readFile(target));
    assert.deepEqual(pdf.getPages().map(p => p.getWidth()), [202, 204]);
    const reader = await getDocument({ data: new Uint8Array(await readFile(target)) }).promise;
    try { assert.deepEqual(await reader.getPageLabels(), ['1', '3']); } finally { await reader.destroy(); }
    assert.deepEqual(await readFile(path.join(root, 'tmp/bsmart/42/000003.pdf')), assets[2]);
    assert.ok(events.some(event => event.phase === 'download' && event.completed === 2 && event.total === 2));
    requested.length = 0;
    const resumed = [];
    await downloadBook({ ...options, pageSelection: '2-3', onProgress: event => resumed.push(event) });
    assert.deepEqual(requested, [3]);
    assert.equal(resumed.findLast(event => event.phase === 'download').resumed, 1);
    requested.length = 0;
    await downloadBook(options);
    assert.deepEqual(requested.sort(), [0, 1, 5]);
    await assert.rejects(downloadBook({ ...options, pageSelection: '1', limit: 1 }), /Non combinare/);
  } finally { globalThis.fetch = previous; }
});

test('MyDBook: etichette da details, indice escluso e cache senza URL firmati', async () => {
  await mkdir('tmp/page-selection-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/page-selection-tests/labels-'));
  const titles = ['Copertina', 'I', 'II', '1', '2', '3']; let calls = 0;
  const api = {
    pageProps: async () => ({ user: { bookcodes: ['TEST'] }, listPages: titles.map((_, i) => ({ id: String(i + 100), position: 'R' })), infoFixedPage: { title: 'Libro', pages: [] } }),
    json: async url => { calls++; const id = url.split('/').at(-1); return { pages: [{ id, title: titles[Number(id) - 100], url: 'https://private.example/?token=not-to-cache' }] }; },
  };
  const options = { resolveLabels: true, labelsCache: path.join(root, 'page-labels.json') };
  const book = await mydbookMetadata(api, { id: 'TEST' }, options);
  assert.deepEqual(selectPages(book.pages, '1, 3').indices, [3, 5]);
  assert.equal(calls, 6);
  await mydbookMetadata(api, { id: 'TEST' }, options); assert.equal(calls, 6);
  assert.equal((await readFile(options.labelsCache, 'utf8')).includes('private.example'), false);
});
