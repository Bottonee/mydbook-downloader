import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { flowbooks, flowbooksDigistore } from '../src/providers/flowbooks.js';
import { Api } from '../src/api.js';
import { providerList } from '../src/providers/index.js';
import { downloadBook } from '../src/download.js';
import { closeImages } from '../src/images.js';

const props = data => new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: data } })}</script>`);
test('FlowBooks: cookie e header del solo origin ufficiale, tenant e funzionalità separati', async () => {
  const source = { cookies: { get: async ({ url }) => url === 'https://flowbooks.olhos.it' ? [{ name: 'userToken', value: 'flow-fixture' }] : [] } };
  assert.equal(await flowbooks.extractToken(source), 'flow-fixture');
  source.cookies.get = async () => [];
  source.capturedHeaders = [{ url: 'https://mydbook.olhos.it/mydbook', headers: { Authorization: 'Bearer wrong-service' } }];
  assert.equal(await flowbooks.extractToken(source), null);
  source.capturedHeaders[0].url = 'https://flowbooks.olhos.it/edisco';
  assert.equal(await flowbooks.extractToken(source), 'wrong-service');
  assert.equal(flowbooks.config.tenant, 'edisco'); assert.equal(flowbooksDigistore.config.tenant, 'digistore');
  assert.equal(flowbooks.config.readerUrl('BOOK'), 'https://flowbooks.olhos.it/edisco/BOOK/1/fixed');
  for (const id of ['flowbooks', 'flowbooks-digistore']) {
    const provider = providerList.find(provider => provider.id === id);
    assert.equal(provider.downloadSupported, true); assert.equal(provider.openSupported, true); assert.equal(provider.ocrSupported, true);
  }
});

test('FlowBooks Edisco e DigiStore: libreria posseduta, lettore fixed, PDF, etichette e ripresa isolata', async () => {
  const previous = globalThis.fetch, root = await mkdtemp(path.join(os.tmpdir(), 'flowbooks-'));
  const canvas = createCanvas(120, 180); const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 120, 180);
  const image = canvas.toBuffer('image/png');
  let images = 0;
  globalThis.fetch = async (value, { headers }) => {
    const url = new URL(value);
    assert.equal(url.origin, 'https://flowbooks.olhos.it');
    assert.equal(headers.Authorization, 'Bearer fixture'); assert.equal(headers.Cookie, 'userToken=fixture');
    if (url.pathname.startsWith('/asset/')) { images++; return new Response(image); }
    if (url.pathname.startsWith('/data/')) return Response.json({ pages: [{ id: url.pathname.endsWith('/z/z') ? 'z' : 'a', title: url.pathname.endsWith('/z/z') ? '1' : '2', url: `https://flowbooks.olhos.it/asset/${url.pathname.endsWith('/z/z') ? 'z' : 'a'}` }] });
    if (url.pathname.endsWith('/dashboard')) return props({ user: { token: 'fixture', bookcodes: ['BOOK'] }, blocks: [{ blockConfiguration: { i18n: { key: 'user_my_books_block' }, volumes: [{ bookcode: 'BOOK', title: 'Libro FlowBooks' }, { bookcode: 'PUBLIC', title: 'Catalogo non attivato' }] } }] });
    assert.match(url.pathname, /^\/(edisco|digistore)\/BOOK\/1\/fixed$/);
    return props({ user: { token: 'fixture', bookcodes: ['BOOK'] }, infoFixedPage: { title: 'Libro FlowBooks', pages: [] }, listPages: [{ id: 'z', position: 0 }, { id: 'a', position: 1 }] });
  };
  try {
    for (const provider of [flowbooks, flowbooksDigistore]) {
      const books = await provider.listBooks('fixture'); assert.equal(books.length, 1); assert.equal(books[0].provider, provider.id);
      const options = { provider: provider.id, token: 'fixture', book: books[0], tmpDir: path.join(root, 'cache'), outputDir: path.join(root, 'output'), quiet: true, pageSelection: '2' };
      const target = await downloadBook(options);
      assert.ok(target.includes(provider.id)); assert.equal((await PDFDocument.load(await readFile(target))).getPageCount(), 1);
      const before = images; const events = [];
      await downloadBook({ ...options, onProgress: event => events.push(event) }); assert.equal(images, before);
      assert.equal(events.findLast(event => event.phase === 'download').resumed, 1);
      const manifest = await readFile(path.join(root, 'cache', provider.id, 'BOOK/manifest.json'), 'utf8'); assert.equal(/fixture|https/.test(manifest), false);
      await assert.rejects(new Api('fixture', undefined, provider.config).request('https://mydbook.olhos.it/data'), /Host/);
    }
    assert.equal(images, 2);
    globalThis.fetch = async () => props({ user: { token: 'fixture', bookcodes: [] }, infoFixedPage: { title: 'Non attivato' }, listPages: [{ id: '1' }] });
    await assert.rejects(flowbooks.getMetadata('fixture', 'PUBLIC'), error => error.status === 403);
    globalThis.fetch = async () => props({ user: { token: 'fixture', bookcodes: [] }, blocks: [] });
    assert.deepEqual(await flowbooks.listBooks('fixture'), []);
    globalThis.fetch = async () => props({ user: { token: 'fixture', bookcodes: ['BOOK'] }, infoFixedPage: { title: 'Libro liquido' }, listPages: [] });
    await assert.rejects(flowbooks.getMetadata('fixture', 'BOOK'), /impaginazione fissa/);
    globalThis.fetch = async () => props({ user: { token: null } });
    assert.equal(await flowbooks.isTokenValid('fixture'), false);
  } finally { globalThis.fetch = previous; await closeImages(); }
});
