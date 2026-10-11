import test from 'node:test';
import assert from 'node:assert/strict';
import { mydbook } from '../src/providers/mydbook.js';
import { bsmart } from '../src/providers/bsmart.js';
import { getProvider } from '../src/providers/index.js';
import { extractConfiguredToken } from '../src/providers/common.js';
import { mydbookConfig } from '../src/providers/mydbook.config.js';
import { Api } from '../src/api.js';

test('estrazione: cookie prima degli header, origin estranei esclusi e token OAuth ignorati', async () => {
  const session = { cookies: { get: async () => [{ name: 'userToken', value: 'cookie-fixture' }] }, capturedHeaders: [{ url: 'https://mydbook.olhos.it/data/v1/test', headers: { Authorization: 'Bearer header-fixture' } }] };
  assert.equal(await mydbook.extractToken(session), 'cookie-fixture');
  session.cookies.get = async () => [];
  assert.equal(await mydbook.extractToken(session), 'header-fixture');
  session.capturedHeaders[0].url = 'https://attacker.example/';
  assert.equal(await mydbook.extractToken(session), null);
  session.capturedHeaders = [{ url: 'https://www.bsmart.it/api/v6/books', headers: { auth_token: 'bsmart-fixture' } }];
  session.readStorage = async () => ({ origin: 'https://my.bsmart.it', local: { dropbox_token: 'oauth-fixture' }, session: {} });
  assert.equal(await bsmart.extractToken(session), 'bsmart-fixture');
  session.rejectedTokens = new Set(['bsmart-fixture']);
  assert.equal(await bsmart.extractToken(session), null);
});

test('estrazione storage e URL: solo chiavi configurate, sola lettura e origin ufficiale', async () => {
  const config = { extraction: { ...mydbookConfig.extraction, cookieNames: [], headerNames: [], storageKeys: ['fixture_key'], urlKeys: ['fixture_param'] } };
  const source = { cookies: { get: async () => [] }, readStorage: async () => ({ origin: 'https://mydbook.olhos.it', local: {}, session: { fixture_key: 'storage-fixture' } }), urls: ['https://mydbook.olhos.it/?fixture_param=url-fixture'] };
  assert.equal(await extractConfiguredToken(source, config), 'storage-fixture');
  source.readStorage = async () => null;
  assert.equal(await extractConfiguredToken(source, config), 'url-fixture');
  source.urls = ['https://attacker.example/?fixture_param=url-fixture'];
  assert.equal(await extractConfiguredToken(source, config), null);
});

test('normalizzazione dei due provider e AUTH_TOKEN bSmart senza cookie MyDBook', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === 'www.bsmart.it') {
      assert.equal(options.headers.AUTH_TOKEN, 'bsmart-fixture');
      assert.equal(options.headers.Cookie, undefined);
      return new Response(JSON.stringify([{ id: 42, title: 'Libro bSmart', authors: ['Autore A', 'Autore B'], page_count: 2, current_edition: { revision: 3 } }]));
    }
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { user: { token: 'fixture', bookcodes: ['OWNED'] }, blocks: [{ blockConfiguration: { i18n: { key: 'user_my_books_block' }, volumes: [{ bookcode: 'OWNED', title: 'Libro MyDBook', coverUrl: '/cover.png' }, { bookcode: 'OTHER', title: 'Non acquistato' }] } }] } } }) + '</script>');
  };
  try {
    const books = await mydbook.listBooks('mydbook-fixture');
    assert.equal(books.length, 1); assert.equal(books[0].id, 'OWNED'); assert.equal(books[0].provider, 'mydbook');
    const smart = await bsmart.listBooks('bsmart-fixture');
    assert.deepEqual(smart[0], { id: '42', title: 'Libro bSmart', author: 'Autore A, Autore B', pagesCount: 2, coverUrl: null, provider: 'bsmart' });
    assert.equal(await bsmart.isTokenValid('bsmart-fixture'), true);
    assert.equal(await bsmart.isTokenValid(''), false);
    assert.equal(await mydbook.isTokenValid('bad;token'), false);
    globalThis.fetch = async () => new Response('', { status: 401 });
    assert.equal(await bsmart.isTokenValid('bsmart-fixture'), false);
    assert.equal(await mydbook.isTokenValid('mydbook-fixture'), false);
    await assert.rejects(new Api('fixture').request('https://www.bsmart.it/api/v6/books'), /Host/);
    assert.throws(() => getProvider('__proto__'), /Provider/);
  } finally { globalThis.fetch = previous; }
});
