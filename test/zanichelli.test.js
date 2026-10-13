import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, publicEncrypt, constants, createCipheriv } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { zanichelli } from '../src/providers/zanichelli.js';
import { providerList, getProvider } from '../src/providers/index.js';
import { encodeSession, decodeSession } from '../src/providers/zanichelli-session.js';
import { ReaderHttp, contentUrl } from '../src/providers/zanichelli-http.js';
import { resourceKey, decryptPage } from '../src/providers/zanichelli-crypto.js';
import { downloadBook } from '../src/download.js';
import { pagePdf } from '../src/providers/zanichelli-pdf.js';
import { unzipSync } from 'fflate';
import { createCanvas } from '@napi-rs/canvas';
import { bundleVolumes, tocVolumes } from '../src/providers/zanichelli-volumes.js';

const session = encodeSession('myz-fixture', 'idp-fixture');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=', 'base64');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs1', format: 'der' }).toString('base64');
const key = Buffer.from('0123456789abcdef');
const encryptedKey = publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_PADDING }, key).toString('base64');
const encrypt = buffer => { const cipher = createCipheriv('aes-128-cbc', key, key); return Buffer.concat([cipher.update(buffer), cipher.final()]).toString('base64'); };

function fixture({ epub = false, missing = false, denied = false, bundled = false } = {}) {
  const counts = { assets: 0, launch: 0 };
  const fetch = async (value, { headers }) => {
    const url = new URL(value);
    if (url.origin === 'https://api-catalogo.zanichelli.it') {
      assert.equal(headers['myz-token'], 'myz-fixture'); assert.equal(headers.Cookie, undefined);
      return Response.json({ realLicenses: [
        ...Array.from({ length: 2 }, () => ({ volume: { isbn: '9780000000001', title: bundled ? 'Confezione 4A+4B con Tutor' : 'Libro fixture', opera: bundled ? { title: 'Matematica.verde' } : undefined, ereader_url: 'https://webmy.zanichelli.it/ebook/9780000000001', ereader_info: { id: 10 } } })),
        { volume: { isbn: '9780000000002', title: 'Solo dizionario', ereader_url: null } },
      ] });
    }
    assert.equal(headers['myz-token'], undefined);
    if (url.origin === 'https://webmy.zanichelli.it') {
      counts.launch++; assert.equal(headers.Cookie, 'token=idp-fixture');
      return new Response(null, { status: 302, headers: { location: 'https://webreader.zanichelli.it/#/reader?bookID=10&usertoken=launch-secret' } });
    }
    if (url.origin === 'https://microservices.kitaboo.eu') {
      assert.equal(headers.Cookie, undefined); assert.equal(url.searchParams.get('usertoken'), 'launch-secret');
      return Response.json({ userToken: 'reader-secret' });
    }
    if (url.origin === 'https://zanichelliservices.kitaboo.eu') {
      assert.equal(headers.usertoken, 'reader-secret'); assert.equal(headers.Cookie, undefined);
      return Response.json({ bookList: [{ book: { ebookID: 100, assetType: epub ? 'EPUB' : 'BOOK' } }] });
    }
    assert.equal(url.origin, 'https://webreader.zanichelli.it');
    if (url.pathname.includes('/downloadapi/')) {
      assert.equal(headers.usertoken, 'reader-secret');
      if (denied) return new Response('', { status: 403 });
      return Response.json({ content_ownership: true, privateKey, jwtToken: 'jwt-secret' }, { headers: { 'Set-Cookie': 'CloudFront-Signature=cdn-secret; Path=/; Secure' } });
    }
    assert.equal(headers.Cookie, 'CloudFront-Signature=cdn-secret'); assert.equal(headers.usertoken, undefined);
    if (url.pathname.endsWith('enc_resource.key')) { assert.equal(headers.authorization, 'jwt-secret'); return new Response(encryptedKey); }
    assert.equal(headers.authorization, undefined);
    if (url.pathname.endsWith('container.xml')) return new Response('<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>');
    if (url.pathname.endsWith('toc.xml')) return new Response('<tocxml><node feild3="Volume A" href="b.xhtml"/><node feild3="Volume B" href="a.xhtml"/></tocxml>');
    if (url.pathname.endsWith('content.opf')) return new Response(epub ? '<package><metadata><dc:title>Libro liquido</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="images/p.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>' : `<package><metadata><dc:title>Libro vettoriale</dc:title></metadata><manifest><item id="imagesbsvgz" href="images/b.svgz" media-type="image/svg+xml"/><item id="imagesasvgz" href="images/a.svgz" media-type="image/svg+xml"/></manifest><spine><itemref idref="b"/><itemref idref="${missing ? 'unknown' : 'a'}"/></spine></package>`);
    if (url.pathname.endsWith('chapter.xhtml')) return new Response('<html xmlns="http://www.w3.org/1999/xhtml"><body>Capitolo uno</body></html>');
    counts.assets++;
    if (url.pathname.endsWith('.png')) return new Response(epub ? png : encrypt(png));
    const width = url.pathname.endsWith('b.svgz') ? 300 : 301;
    return new Response(encrypt(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 500"><rect width="100" height="100" fill="red"/><text x="10" y="20">Testo fixture</text><image href="p.png" x="10" y="30" width="1" height="1"/></svg>`)));
  };
  return { fetch, counts };
}

test('sessione Zanichelli: entrambe le credenziali ufficiali, cookie del lettore e Google esclusi', async () => {
  const source = { cookies: { get: async ({ url }) => url === 'https://my.zanichelli.it' ? [{ name: 'CloudFront-Signature', value: 'ignored' }, { name: 'myz_token', value: 'myz-fixture' }, { name: 'token', value: 'idp-fixture' }] : [] } };
  assert.equal(await zanichelli.extractToken(source), session);
  assert.deepEqual(decodeSession(session), { myzToken: 'myz-fixture', idpToken: 'idp-fixture' });
  source.rejectedTokens = new Set([session]); assert.equal(await zanichelli.extractToken(source), null);
  delete source.rejectedTokens;
  source.cookies.get = async ({ url }) => url === 'https://idp.zanichelli.it' ? [{ name: 'token', value: 'idp-fixture' }] : [];
  source.capturedHeaders = [{ url: 'https://api-catalogo.zanichelli.it/v3/dashboard/licenses/real', headers: { 'myz-token': 'myz-fixture' } }];
  assert.equal(await zanichelli.extractToken(source), session);
  source.capturedHeaders[0].url = 'https://accounts.google.com/login'; assert.equal(await zanichelli.extractToken(source), null);
  assert.throws(() => decodeSession('zanichelli-session:broken'), /Sessione/);
});

test('libreria delle licenze reali, compatibilità del vecchio token e sessioni scadute', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fixture().fetch;
  try {
    const books = await zanichelli.listBooks(session);
    assert.equal(books.length, 1); assert.equal(books[0].provider, 'zanichelli');
    assert.equal(getProvider('zanichelli'), zanichelli);
    assert.equal(providerList.find(p => p.id === 'zanichelli').downloadSupported, true);
    assert.equal(await zanichelli.isTokenValid('myz-fixture'), true);
    await assert.rejects(zanichelli.getPages('myz-fixture', books[0].id), /solo myz-token/);
    globalThis.fetch = async () => new Response('', { status: 401 });
    assert.equal(await zanichelli.isTokenValid(session), false);
  } finally { globalThis.fetch = original; }
});

test('RSA/AES del riferimento con chiavi sintetiche, errori e conversione vettoriale', async () => {
  assert.deepEqual(resourceKey(privateKey, encryptedKey), key);
  assert.deepEqual(decryptPage(key, Buffer.from(encrypt(png))), png);
  assert.throws(() => resourceKey('broken', encryptedKey), /Chiave/);
  assert.throws(() => decryptPage(key, Buffer.from('not base64!')), /danneggiata/);
  const pdf = await PDFDocument.load(await pagePdf(Buffer.from('<svg viewBox="0 0 300 500"><text x="10" y="20">Testo</text></svg>'), 'image/svg+xml'));
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 300, height: 500 });
  await assert.rejects(pagePdf(Buffer.from('<svg viewBox="0 0 1 1"><image href="C:/private.png"/></svg>'), 'image/svg+xml'), /Conversione/);
  const jpeg = createCanvas(1, 1).toBuffer('image/jpeg');
  const embedded = await pagePdf(Buffer.from(`<svg viewBox="0 0 300 500"><image href="data:image/jpg;base64,${jpeg.toString('base64')}" width="10" height="10"/></svg>`), 'image/svg+xml');
  assert.equal((await PDFDocument.load(embedded)).getPageCount(), 1);
});

test('volumi accoppiati: due titoli, confini da toc.xml, PDF e cache distinti, stesso ISBN', async () => {
  const original = globalThis.fetch, root = await mkdtemp(path.join(os.tmpdir(), 'zanichelli-volumes-'));
  globalThis.fetch = fixture({ bundled: true }).fetch;
  try {
    const books = await zanichelli.listBooks(session);
    assert.deepEqual(books.map(book => book.id), ['9780000000001__volume_A', '9780000000001__volume_B']);
    assert.deepEqual(books.map(book => book.title), ['Matematica.verde — 4A con Tutor', 'Matematica.verde — 4B con Tutor']);
    assert.deepEqual(books.map(book => book.pagesCount), [1, 1]);
    const targets = [];
    for (const [i, book] of books.entries()) {
      const target = await downloadBook({ provider: 'zanichelli', token: session, book, quiet: true, tmpDir: path.join(root, 'cache'), outputDir: path.join(root, 'output') });
      targets.push(target);
      const pdf = await PDFDocument.load(await readFile(target));
      assert.equal(pdf.getPageCount(), 1); assert.equal(pdf.getPage(0).getWidth(), 300 + i);
      const manifest = JSON.parse(await readFile(path.join(root, 'cache/zanichelli', book.id, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.pageIds, [i ? 'a' : 'b']);
    }
    assert.notEqual(targets[0], targets[1]);
    await assert.rejects(zanichelli.getMetadata(session, '9780000000001__volume_C'), error => error.status === 403);
  } finally { globalThis.fetch = original; }
});

test('identità dei libri: ebook distinti con lo stesso ISBN non vengono accorpati', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ realLicenses: [10, 11, 10].map(id => ({ volume: { isbn: '9780000000001', title: id === 10 ? 'Volume 4A' : 'Volume 4B', opera: { title: 'Matematica' }, ereader_url: `https://webmy.zanichelli.it/ebook/${id}`, ereader_info: { id } } })) });
  try {
    const books = await zanichelli.listBooks(session);
    assert.deepEqual(books.map(book => book.id), ['9780000000001__ebook_10', '9780000000001__ebook_11']);
    assert.deepEqual(books.map(book => book.readerUrl), ['https://webmy.zanichelli.it/ebook/10', 'https://webmy.zanichelli.it/ebook/11']);
  } finally { globalThis.fetch = original; }
});

test('confini dei volumi: riferimenti sconosciuti, ambigui o non consecutivi vengono rifiutati', () => {
  assert.equal(bundleVolumes('Volume unico'), null);
  assert.deepEqual(bundleVolumes('Confezione 4A + 4B con Tutor').letters, ['A', 'B']);
  const pages = ['p1', 'p2', 'p3'].map(id => ({ id }));
  const node = (letter, href) => ({ $: { feild3: 'Volume ' + letter, href } });
  assert.throws(() => tocVolumes({ tocxml: { node: [node('A', 'p1.xhtml'), node('B', 'missing.xhtml')] } }, pages, ['A', 'B']), /non corrispondente/);
  assert.throws(() => tocVolumes({ tocxml: { node: [node('A', 'p1.xhtml'), node('B', 'p2.xhtml'), node('A', 'p3.xhtml')] } }, pages, ['A', 'B']), /non consecutive/);
  assert.throws(() => tocVolumes({ tocxml: { node: [node('A', 'p1.xhtml'), node('B', 'p1.xhtml')] } }, pages, ['A', 'B']), /ambiguo/);
});

test('PDF completo: ordine spine, risorse inlined, ripresa, selezione e cache senza segreti', async () => {
  const original = globalThis.fetch, root = await mkdtemp(path.join(os.tmpdir(), 'zanichelli-'));
  const mock = fixture(); globalThis.fetch = mock.fetch;
  const options = { provider: 'zanichelli', token: session, book: { id: '9780000000001', title: 'Fixture' }, tmpDir: path.join(root, 'tmp'), outputDir: path.join(root, 'output'), quiet: true };
  try {
    const target = await downloadBook(options);
    const pdf = await PDFDocument.load(await readFile(target));
    assert.deepEqual(pdf.getPages().map(p => p.getWidth()), [300, 301]);
    const manifest = await readFile(path.join(root, 'tmp/zanichelli/9780000000001/manifest.json'), 'utf8');
    assert.deepEqual(JSON.parse(manifest).pageIds, ['b', 'a']);
    assert.equal(/secret|fixture|https|privateKey|Cookie/.test(manifest), false);
    const assets = mock.counts.assets;
    const events = []; await downloadBook({ ...options, onProgress: event => events.push(event) });
    assert.equal(mock.counts.assets, assets); assert.equal(events.findLast(e => e.phase === 'download').resumed, 2);
    await writeFile(path.join(root, 'tmp/zanichelli/9780000000001/000002.pdf'), 'broken');
    await downloadBook(options); assert.equal(mock.counts.assets, assets + 2);
    const selected = await downloadBook({ ...options, pageSelection: '1', firstDigitalPage: 2 });
    assert.equal((await PDFDocument.load(await readFile(selected))).getPage(0).getWidth(), 301);
    await assert.rejects(downloadBook({ ...options, pageSelection: '1' }), /numerazione|etichette|calibrazione/i);
    globalThis.fetch = fixture({ missing: true }).fetch;
    await assert.rejects(downloadBook(options), /nessuna immagine/);
    globalThis.fetch = fixture({ denied: true }).fetch;
    await assert.rejects(downloadBook(options), error => error.status === 403);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(downloadBook({ ...options, signal: controller.signal }));
  } finally { globalThis.fetch = original; }
});

test('EPUB liquido: mimetype iniziale non compresso, manifest e tutte le risorse, opzioni pagine rifiutate', async () => {
  const original = globalThis.fetch, root = await mkdtemp(path.join(os.tmpdir(), 'zanichelli-epub-'));
  globalThis.fetch = fixture({ epub: true }).fetch;
  const options = { provider: 'zanichelli', token: session, book: { id: '9780000000001', title: 'Fixture' }, tmpDir: path.join(root, 'tmp'), outputDir: root, quiet: true };
  try {
    const target = await downloadBook(options), bytes = await readFile(target);
    assert.equal(path.extname(target), '.epub');
    assert.equal(bytes.readUInt16LE(8), 0); assert.equal(bytes.subarray(30, 38).toString(), 'mimetype');
    const zip = unzipSync(bytes);
    assert.equal(Buffer.from(zip.mimetype).toString(), 'application/epub+zip');
    assert.ok(zip['META-INF/container.xml']); assert.ok(zip['OPS/content.opf']);
    assert.match(Buffer.from(zip['OPS/chapter.xhtml']).toString(), /Capitolo uno/);
    assert.deepEqual(Buffer.from(zip['OPS/images/p.png']), png);
    await assert.rejects(downloadBook({ ...options, limit: 1 }), /EPUB/);
    await assert.rejects(downloadBook({ ...options, pageSelection: '1' }), /EPUB/);
    assert.equal((await readdir(path.dirname(target))).some(name => name.endsWith('.part')), false);
  } finally { globalThis.fetch = original; }
});

test('trasporto: host esterni e path traversal rifiutati, cookie per origin, retry e redirect senza header', async () => {
  const http = new ReaderHttp('idp-fixture');
  await assert.rejects(http.request('https://attacker.example'), /Host/);
  assert.throws(() => contentUrl('../secret', 'https://webreader.zanichelli.it/100/OPS/'), /Percorso/);
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, { headers }) => {
    calls++;
    if (calls === 1) return new Response('', { status: 503 });
    if (calls === 2) return new Response(null, { status: 302, headers: { location: 'https://microservices.kitaboo.eu/test' } });
    assert.equal(new URL(url).origin, 'https://microservices.kitaboo.eu');
    assert.equal(headers.usertoken, undefined); assert.equal(headers.Cookie, undefined);
    return new Response('ok');
  };
  try {
    assert.equal((await http.request('https://my.zanichelli.it/test', { headers: { usertoken: 'secret' }, redirect: true })).buffer.toString(), 'ok');
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example' } });
    await assert.rejects(http.request('https://my.zanichelli.it/test'), /Host/);
  } finally { globalThis.fetch = original; }
});

test('Booktab precedente: sessione POST, fallback volume.xml, unità PDF e formato XPS rifiutato', async () => {
  const original = globalThis.fetch, root = await mkdtemp(path.join(os.tmpdir(), 'zanichelli-booktab-'));
  const unit = await PDFDocument.create(); unit.addPage([200, 400]); unit.addPage([201, 401]);
  const bytes = await unit.save(); let xps = false;
  globalThis.fetch = async (value, { headers, method }) => {
    const url = new URL(value);
    if (url.origin === 'https://api-catalogo.zanichelli.it') return Response.json({ realLicenses: [{ volume: { isbn: '9780000000001', title: 'Vecchio Booktab', ereader_url: 'https://my.zanichelli.it/ebook/9780000000001', ereader_info: { id: 10 } } }] });
    if (url.origin === 'https://my.zanichelli.it') return new Response(null, { status: 302, headers: { location: 'https://web-booktab.zanichelli.it/reader' } });
    assert.equal(url.origin, 'https://web-booktab.zanichelli.it');
    if (url.pathname.endsWith('sessions_web')) { assert.equal(method, 'POST'); assert.equal(headers.Cookie, 'token=idp-fixture'); return Response.json({ session: 'booktab-fixture' }); }
    assert.match(headers.Cookie, /token=idp-fixture/); assert.match(headers.Cookie, /booktab_token=booktab-fixture/);
    if (url.pathname.endsWith('spine.xml')) return new Response('', { status: 404 });
    if (url.pathname.endsWith('volume.xml')) return new Response('<config><volume><settings><volumetitle>Vecchio Booktab</volumetitle></settings><units><unit btbid="unit1" features="html5"/></units></volume></config>');
    if (url.pathname.endsWith('config.xml')) return new Response('<unit><content>content</content><filesMap><entry key="content.pdf">mapped</entry></filesMap></unit>');
    assert.ok(url.pathname.endsWith('/unit1/mapped.pdf'));
    return xps ? new Response('', { status: 404 }) : new Response(bytes);
  };
  const options = { provider: 'zanichelli', token: session, book: { id: '9780000000001', title: 'Fixture' }, tmpDir: path.join(root, 'tmp'), outputDir: root, quiet: true };
  try {
    const target = await downloadBook(options);
    assert.deepEqual((await PDFDocument.load(await readFile(target))).getPages().map(page => page.getWidth()), [200, 201]);
    xps = true;
    await assert.rejects(downloadBook(options), /XPS\/XOD/);
  } finally { globalThis.fetch = original; }
});
