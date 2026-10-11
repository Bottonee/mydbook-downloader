import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { Api } from '../src/api.js';
import { bsmart } from '../src/providers/bsmart.js';
import { decryptResource, extractReaderKey } from '../src/providers/bsmart-crypto.js';
import { downloadBook } from '../src/download.js';
import { encryptedResource, fixtureKey, pagePdf, readerBundle } from './bsmart-fixtures.mjs';

test('formato bSmart: estrazione statica senza eval e decifratura del prefisso MessagePack/AES-CBC', async () => {
  assert.deepEqual(extractReaderKey(readerBundle()), fixtureKey);
  assert.equal(extractReaderKey('globalThis.remoteCodeExecuted=true;'), null);
  assert.equal(globalThis.remoteCodeExecuted, undefined);
  const pdf = await pagePdf();
  assert.deepEqual(decryptResource(encryptedResource(pdf), fixtureKey), pdf);
  assert.throws(() => decryptResource(Buffer.alloc(300), fixtureKey), /non valida/);
  assert.throws(() => decryptResource(encryptedResource(pdf), Buffer.alloc(4)), /non valida/);
});

test('API bSmart: preattivazioni, risorse paginate e ordine originale page_pdf', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, { headers }) => {
    assert.equal(headers.AUTH_TOKEN, 'fixture');
    const parsed = new URL(url); seen.push(parsed.pathname + parsed.search);
    let body;
    if (parsed.pathname.endsWith('/preactivations')) body = [{ no_bsmart: false, books: [{ id: 42, title: 'Duplicato' }, { id: 43, title: 'Preattivato' }] }, { no_bsmart: true, books: [{ id: 44, title: 'Altro provider' }] }];
    else if (parsed.pathname.includes('/by_book_id/')) body = { id: 42, title: 'Libro', current_edition: { revision: 7 } };
    else if (parsed.pathname.endsWith('/resources')) body = parsed.searchParams.get('page') === '1' ? Array.from({ length: 500 }, (_, i) => ({ assets: i === 0 ? [{ id: 'z', use: 'page_pdf', url: 'https://cdn.example/p1', encrypted: false }, { id: 'audio', use: 'launch_file', url: 'https://cdn.example/audio' }] : [] })) : [{ assets: [{ filename: 'a.pdf', use: 'page_pdf', url: 'https://cdn.example/p2' }] }];
    else body = [{ id: 42, title: 'Libro' }];
    return new Response(JSON.stringify(body));
  };
  try {
    assert.deepEqual((await bsmart.listBooks('fixture')).map(book => book.id), ['42', '43']);
    const pages = await bsmart.getPages('fixture', '42');
    assert.deepEqual(pages.map(page => page.id), ['z', 'a.pdf']);
    assert.equal(pages[0].encrypted, false); assert.equal(pages[1].encrypted, true);
    assert.ok(seen.includes('/api/v5/books/42/7/resources?per_page=500&page=2'));
  } finally { globalThis.fetch = original; }
});

test('pipeline bSmart: CDN senza token, PDF nativi, retry, ripresa e cache priva di URL/chiavi', async () => {
  const original = globalThis.fetch, root = await mkdtemp(path.join(os.tmpdir(), 'bsmart-test-'));
  const pdfs = await Promise.all([pagePdf(0), pagePdf(1)]);
  const calls = { assets: 0, reader: 0, scripts: 0 };
  let throttle = true;
  globalThis.fetch = async (url, { headers }) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.bsmart.it') {
      assert.equal(headers.AUTH_TOKEN, undefined); assert.equal(headers.Cookie, undefined); assert.equal(headers.Authorization, undefined);
      if (parsed.hostname === 'my.bsmart.it') {
        if (parsed.pathname === '/') { calls.reader++; return new Response('<script src="/scripts/fixture.js"></script><script src="https://untrusted.example/ignored.js"></script>'); }
        calls.scripts++; return new Response(readerBundle());
      }
      calls.assets++;
      if (throttle) { throttle = false; return new Response('', { status: 429 }); }
      return new Response(parsed.pathname === '/p1' ? encryptedResource(pdfs[0]) : pdfs[1]);
    }
    assert.equal(headers.AUTH_TOKEN, 'fixture-secret');
    if (parsed.pathname.includes('/by_book_id/')) return new Response(JSON.stringify({ id: 42, title: 'PDF nativo', current_edition: { revision: 7 } }));
    return new Response(JSON.stringify([{ assets: [{ id: 11, use: 'page_pdf', url: 'https://cdn.example/p1?signature=fixture', encrypted: true }, { id: 12, use: 'page_pdf', url: 'https://cdn.example/p2', encrypted: false }] }]));
  };
  try {
    const events = [], options = { provider: 'bsmart', token: 'fixture-secret', book: { id: '42', title: 'PDF nativo' }, tmpDir: path.join(root, 'tmp'), outputDir: path.join(root, 'output'), quiet: true, compress: true, onProgress: event => events.push(event) };
    const target = await downloadBook(options);
    assert.equal(path.basename(target), 'PDF nativo.pdf');
    const merged = await PDFDocument.load(await readFile(target));
    assert.deepEqual(merged.getPages().map(page => page.getSize()), [{ width: 300, height: 500 }, { width: 301, height: 501 }]);
    assert.ok(merged.getPages()[0].node.Resources().has((await import('pdf-lib')).PDFName.of('Font')));
    assert.equal(calls.assets, 3); assert.equal(calls.reader, 1); assert.equal(calls.scripts, 1);
    const cache = path.join(root, 'tmp/bsmart/42');
    assert.deepEqual(await readFile(path.join(cache, '000001.pdf')), pdfs[0]);
    const manifest = await readFile(path.join(cache, 'manifest.json'), 'utf8');
    assert.equal(/fixture-secret|signature|https:|0123456789abcdef/.test(manifest), false);
    const resumed = [];
    await downloadBook({ ...options, onProgress: event => resumed.push(event) });
    assert.equal(calls.assets, 3); assert.equal(resumed.findLast(event => event.phase === 'download').resumed, 2);
    await writeFile(path.join(cache, '000002.pdf'), 'corrotto');
    await downloadBook(options); assert.equal(calls.assets, 4);
    await assert.rejects(new Api('fixture-secret').request('https://cdn.example/page'), /Host/);
    await assert.rejects(new Api('fixture-secret').request('http://cdn.example/page', { authenticate: false }), /non sicuro/);
    await assert.rejects(new Api('fixture-secret').request('https://127.0.0.1/page', { authenticate: false }), /non sicuro/);
  } finally { globalThis.fetch = original; }
});
