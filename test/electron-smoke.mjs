import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { loadToken } from '../src/api.js';
import { PDFDocument } from 'pdf-lib';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const env = { ...process.env, MYDBOOK_TEST_DATA_DIR: path.resolve('tmp/desktop-smoke') };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
let loginFixture;
await mkdir(env.MYDBOOK_TEST_DATA_DIR, { recursive: true });
if (!packaged) {
  for (const name of ['token.bin', 'token-mydbook.bin', 'token-bsmart.bin']) await unlink(path.join(env.MYDBOOK_TEST_DATA_DIR, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writeFile(path.join(env.MYDBOOK_TEST_DATA_DIR, 'settings.json'), JSON.stringify({ provider: 'mydbook' }));
}
const app = await _electron.launch({ args: packaged ? [] : ['.'], executablePath: packaged ? path.resolve('dist/win-unpacked/MyDbook Downloader.exe') : undefined, env, timeout: 45000 });
try {
  const window = await app.firstWindow(); await window.waitForSelector('#load');
  assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
  const security = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox };
  });
  assert.deepEqual(security, { contextIsolation: true, nodeIntegration: false, sandbox: true });
  const crypto = await app.evaluate(({ safeStorage }) => {
    const ciphertext = safeStorage.encryptString('test-only-secret');
    return { encrypted: !ciphertext.includes(Buffer.from('test-only-secret')), restored: safeStorage.decryptString(ciphertext) === 'test-only-secret' };
  });
  assert.deepEqual(crypto, { encrypted: true, restored: true });
  await mkdir('tmp/desktop-smoke', { recursive: true });
  await window.screenshot({ path: 'tmp/desktop-smoke/idle.png' });
  const token = process.argv.includes('--live') ? loadToken() : 'fake-test-token';
  if (!packaged && !process.argv.includes('--live')) await app.evaluate(() => {
    globalThis.fetch = async () => new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { user: { token: 'fake-test-token', bookcodes: ['TEST_BOOK'] }, blocks: [{ blockConfiguration: { i18n: { key: 'user_my_books_block' }, volumes: [{ bookcode: 'TEST_BOOK', title: 'Libro di prova' }] } }] } } }) + '</script>');
  });
  if (!packaged) {
  await window.locator('#advanced').evaluate(element => { element.open = true; });
  await window.locator('#remember').uncheck();
  await window.locator('#token').fill(token); await window.locator('#load').click();
  await window.waitForSelector('.book', { timeout: 45000 });
  assert.equal(await window.locator('#token').inputValue(), '');
  await window.locator('.book').first().click(); assert.equal(await window.locator('#download').isEnabled(), true);
  await window.screenshot({ path: 'tmp/desktop-smoke/library.png' });
  await window.locator('#search').fill('non-esiste-questa-ricerca'); assert.equal(await window.locator('.book').count(), 0);
  await window.locator('#search').fill('');
  }
  // Il dialogo nativo viene verificato attraverso lo stesso handler con un risultato controllato.
  const outputDir = path.resolve('tmp/desktop-smoke/output');
  if (!packaged) {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, outputDir);
    await window.locator('#choose-output').click(); await window.waitForFunction(folder => document.getElementById('output').textContent === folder, outputDir);
  }
  {
    const live = process.argv.includes('--live');
    const data = { token, book: live ? { id: 'GIAC23_G2350103A', title: 'Classe di letteratura - volume 1' } : { id: 'TEST_BOOK', title: 'Libro di prova offline' }, tmpDir: live ? path.resolve('tmp') : path.resolve('tmp/desktop-smoke/cache'), outputDir, compress: true, quality: 80, limit: 3, fixtureImage: path.resolve('build/icon.png') };
    const result = await app.evaluate(async ({ app }, { data, fixtureUrl, live }) => {
      const requireModule = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
      const { DownloadJob } = requireModule('./electron/download-job.js');
      return new Promise(resolve => { const phases = []; new DownloadJob(data, event => { if (event.type === 'progress') phases.push(event.phase); else resolve({ ...event, phases }); }, live ? {} : { execArgv: ['--import', fixtureUrl] }); });
    }, { data, fixtureUrl: pathToFileURL(path.resolve('test/worker-fixture.mjs')).href, live });
    assert.equal(result.type, 'done'); assert.ok(result.phases.includes('download')); assert.ok(result.phases.includes('pdf')); assert.ok(result.phases.includes('saving'));
    assert.equal((await PDFDocument.load(await readFile(result.target))).getPageCount(), 3);
  }
  // Avvio e annullamento della GUI: nessun download completo durante la verifica.
  if (!packaged) {
  await window.locator('#download').click(); await window.locator('#cancel').click();
  await window.waitForFunction(() => document.getElementById('cancel').hidden, { timeout: 10000 });
  assert.match(await window.locator('#notice').innerText(), /annullata/);
  const expired = 'eyJ0eXAiOiJKV1QifQ.' + Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url') + '.test';
  await app.evaluate(async ({ session }) => {
    const ses = session.fromPartition('persist:mydbook');
    await ses.protocol.handle('https', () => new Response('<html><body>Login ufficiale simulato offline</body></html>', { headers: { 'Content-Type': 'text/html' } }));
  });
  const loginCreated = app.waitForEvent('window');
  await window.locator('#token').fill(expired); await window.locator('#load').click();
  const loginWindow = await loginCreated;
  await loginWindow.waitForLoadState('domcontentloaded');
  const loginSecurity = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('Accedi a'));
    const preferences = win.webContents.getLastWebPreferences();
    return { contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox };
  });
  assert.deepEqual(loginSecurity, { contextIsolation: true, nodeIntegration: false, sandbox: true });
  await app.evaluate(async ({ session }) => { await session.fromPartition('persist:mydbook').cookies.set({ url: 'https://mydbook.olhos.it', name: 'userToken', value: 'fake-test-token', path: '/', secure: true }); });
  await window.waitForFunction(() => document.getElementById('connection').textContent === 'Connesso');
  assert.equal(await window.locator('.book').count(), 1);
  const persisted = await readFile(path.join(env.MYDBOOK_TEST_DATA_DIR, 'token-mydbook.bin'));
  assert.equal(persisted.includes(Buffer.from('fake-test-token')), false);
  // The CLI helper decrypts via Electron and a local pipe, without credentials on stdout or in argv.
  const oldTestDirectory = process.env.MYDBOOK_TEST_DATA_DIR;
  process.env.MYDBOOK_TEST_DATA_DIR = env.MYDBOOK_TEST_DATA_DIR;
  try { const { loadSavedSession } = await import('../src/saved-session.js'); assert.equal(await loadSavedSession('mydbook'), 'fake-test-token'); }
  finally { if (oldTestDirectory === undefined) delete process.env.MYDBOOK_TEST_DATA_DIR; else process.env.MYDBOOK_TEST_DATA_DIR = oldTestDirectory; }
  await window.locator('#disconnect').click(); await window.waitForFunction(() => document.getElementById('connection').textContent === 'Non connesso');
  assert.equal(await app.evaluate(async ({ session }) => (await session.fromPartition('persist:mydbook').cookies.get({ url: 'https://mydbook.olhos.it' })).some(c => c.name === 'userToken')), false);
  await assert.rejects(readFile(path.join(env.MYDBOOK_TEST_DATA_DIR, 'token-mydbook.bin')), { code: 'ENOENT' });
  await app.evaluate(() => { globalThis.fetch = async () => new Response(JSON.stringify([{ id: 42, title: 'Libro bSmart offline', page_count: 3 }])); });
  // A local HTTP fixture exercises Chromium's real onBeforeSendHeaders hook. No credentials leave the machine.
  loginFixture = createServer((request, response) => {
    assert.equal(request.headers['user-agent'].includes('Electron/'), false);
    if (request.url.startsWith('/api/')) { response.setHeader('Content-Type', 'application/json'); response.end('[]'); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<html><body>Login bSmart simulato<script>fetch("/api/v6/books", {headers:{AUTH_TOKEN:"bsmart-fixture"}})</script></body></html>'); }
  });
  await new Promise(resolve => loginFixture.listen(0, '127.0.0.1', resolve));
  await app.evaluate(({ app }, fixtureOrigin) => {
    const requireModule = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const { bsmart } = requireModule('./src/providers/bsmart.js');
    bsmart.loginUrl = fixtureOrigin; bsmart.config.extraction.origins.push(fixtureOrigin);
  }, `http://127.0.0.1:${loginFixture.address().port}`);
  await window.locator('#provider').selectOption('bsmart'); await window.waitForFunction(() => !document.getElementById('token').disabled);
  await window.locator('#login').click(); await window.waitForSelector('.book');
  assert.equal(await window.locator('#connection').innerText(), 'Connesso');
  assert.equal((await readFile(path.join(env.MYDBOOK_TEST_DATA_DIR, 'token-bsmart.bin'))).includes(Buffer.from('bsmart-fixture')), false);
  await window.locator('.book').click(); assert.equal(await window.locator('#download').isEnabled(), true);
  assert.equal(await window.locator('#compress').isEnabled(), false);
  assert.match(await window.locator('#compression-help').innerText(), /PDF originali/);
  const smartResult = await app.evaluate(async ({ app }, { fixtureUrl, outputDir, tmpDir }) => {
    const requireModule = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const { DownloadJob } = requireModule('./electron/download-job.js');
    return new Promise(resolve => {
      new DownloadJob({ provider: 'bsmart', token: 'bsmart-fixture', book: { id: '42', title: 'Libro bSmart offline' }, outputDir, tmpDir }, event => {
        if (event.type !== 'progress') resolve(event);
      }, { execArgv: ['--import', fixtureUrl] });
    });
  }, { fixtureUrl: pathToFileURL(path.resolve('test/bsmart-worker-fixture.mjs')).href, outputDir, tmpDir: path.resolve('tmp/desktop-smoke/bsmart-cache') });
  assert.equal(smartResult.type, 'done');
  const smartPdf = await PDFDocument.load(await readFile(smartResult.target));
  assert.equal(smartPdf.getPageCount(), 3);
  assert.deepEqual(smartPdf.getPages().map(page => page.getWidth()), [300, 301, 302]);
  await window.locator('#disconnect').click(); await window.waitForFunction(() => document.getElementById('connection').textContent === 'Non connesso');
  }
  console.log(packaged ? 'App confezionata verificata: isolamento, safeStorage e worker PDF da app.asar senza Playwright.' : 'Desktop verificato: isolamento, login cookie MyDBook/header bSmart, vault separati, pipe CLI, riconnessione, disconnessione, worker PDF e annullamento.');
} finally { await app.close(); if (loginFixture) await new Promise(resolve => loginFixture.close(resolve)); }
