import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Api, ApiError, validateToken } from '../src/api.js';
import { listBooks, safeId } from '../src/books.js';
import { validateJpegQuality } from '../src/images.js';
import { TokenVault } from './token-vault.js';
import { userError } from './errors.js';
import { DownloadJob } from './download-job.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const uiUrl = new URL('./ui/index.html', import.meta.url).href;
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
app.setName(metadata.productName || metadata.name);
let window, vault, token = '', books = [], job, loading = false, remembered = false, outputDir, stateFile;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
  const testDirectory = !app.isPackaged && process.env.MYDBOOK_TEST_DATA_DIR;
  const dataDir = testDirectory ? path.resolve(testDirectory) : app.getPath('userData');
  vault = new TokenVault(dataDir, safeStorage);
  stateFile = path.join(dataDir, 'settings.json');
  outputDir = path.join(app.getPath('downloads'), 'MyDbook');
  try { const saved = JSON.parse(await readFile(stateFile, 'utf8')); if (typeof saved.outputDir === 'string' && path.isAbsolute(saved.outputDir)) outputDir = saved.outputDir; } catch {}
  let vaultWarning = '';
  try { token = await vault.load() || ''; } catch (error) { vaultWarning = userError(error); }
  remembered = Boolean(token);
  const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiUrl) return { ok: false, message: 'Richiesta non autorizzata.' };
    try { return { ok: true, ...(await action(...args)) }; }
    catch (error) { return { ok: false, message: userError(error, token) }; }
  });
  handle('app:state', async () => ({ version: app.getVersion(), name: app.getName(), remembered, canRemember: vault.available(), outputDir, warning: vaultWarning }));
  handle('token:forget', async () => { await vault.forget(); remembered = false; return {}; });
  handle('books:load', async data => {
    if (job || loading) throw new ApiError('Attendi la fine dell’operazione in corso.');
    if (!data || typeof data.token !== 'string' || typeof data.remember !== 'boolean') throw new ApiError('Dati di accesso non validi.');
    loading = true;
    try {
      const candidate = validateToken(data.token || token);
      const result = await listBooks(new Api(candidate));
      if (data.remember) await vault.save(candidate); else await vault.forget();
      token = candidate; books = result;
      remembered = data.remember;
      return { books: result.map(book => {
        let coverUrl = null;
        try { const u = new URL(book.coverUrl); if (u.origin === 'https://mydbook.olhos.it' && !u.href.includes(candidate)) coverUrl = u.href; } catch {}
        return { id: book.id, title: book.title, subtitle: book.subtitle, coverUrl };
      }), remembered: data.remember };
    } finally { loading = false; }
  });
  handle('output:choose', async () => {
    if (job) throw new ApiError('Attendi o annulla il download prima di cambiare cartella.');
    const result = await dialog.showOpenDialog(window, { title: 'Scegli dove salvare i PDF', defaultPath: outputDir, properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled && result.filePaths[0]) {
      outputDir = result.filePaths[0]; await mkdir(dataDir, { recursive: true });
      await writeFile(stateFile, JSON.stringify({ outputDir }), { mode: 0o600 });
    }
    return { outputDir };
  });
  handle('download:start', async data => {
    if (job || loading) throw new ApiError('È già in corso un’operazione.');
    if (!data || typeof data.compress !== 'boolean') throw new ApiError('Opzioni download non valide.');
    const id = safeId(data.id); const selected = books.find(book => book.id === id);
    if (!selected) throw new ApiError('Libro non trovato. Carica i tuoi libri e seleziona un titolo.');
    validateToken(token); const quality = validateJpegQuality(data.quality);
    const tmpDir = app.isPackaged || testDirectory ? path.join(dataDir, 'tmp') : path.resolve(directory, '../tmp');
    job = new DownloadJob({ book: selected, token, outputDir, tmpDir, compress: data.compress, quality }, event => {
      if (['done', 'failed', 'cancelled'].includes(event.type)) job = null;
      if (window && !window.isDestroyed()) window.webContents.send('download:event', event);
    });
    return {};
  });
  handle('download:cancel', async () => { job?.cancel(); return {}; });
  function createWindow() {
    window = new BrowserWindow({ width: 1160, height: 820, minWidth: 800, minHeight: 650, show: false, title: app.getName(),
      icon: path.join(directory, '..', metadata.appIcon), backgroundColor: '#f7f8f6',
      webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    });
    Menu.setApplicationMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.once('ready-to-show', () => window.show());
    window.on('close', event => {
      if (job) { event.preventDefault(); job.cancel(); const timer = setInterval(() => { if (!job) { clearInterval(timer); window.destroy(); app.quit(); } }, 100); }
    });
    window.loadURL(uiUrl);
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { job?.cancel(); token = ''; books = []; });
  }).catch(() => { dialog.showErrorBox('Avvio non riuscito', 'Impossibile avviare MyDbook Downloader. Verifica i permessi della cartella dei dati dell’app.'); app.quit(); });
}
