import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { loadToken } from '../src/api.js';
import { PDFDocument } from 'pdf-lib';
import { pathToFileURL } from 'node:url';
const env = { ...process.env, MYDBOOK_TEST_DATA_DIR: path.resolve('tmp/desktop-smoke') };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
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
  await window.locator('#token').fill(expired); await window.locator('#load').click(); await window.waitForFunction(() => document.getElementById('notice').textContent.includes('Token scaduto'));
  }
  console.log(packaged ? 'App confezionata verificata: isolamento, safeStorage e worker PDF da app.asar senza Playwright.' : 'Desktop verificato: isolamento, safeStorage, IPC, libreria, cartella, worker PDF, annullamento e token scaduto.');
} finally { await app.close(); }
