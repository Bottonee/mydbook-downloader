import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ApiError, validateToken } from '../src/api.js';
import { parsePages } from '../src/page-selection.js';
import { safeId } from '../src/books.js';
import { getProvider, providerList } from '../src/providers/index.js';
import { validateJpegQuality } from '../src/images.js';
import { TokenVault } from './token-vault.js';
import { userError } from './errors.js';
import { DownloadJob } from './download-job.js';
import { loginProvider, clearProviderSession } from './provider-login.js';
import { isSessionPipe, sendCliSession } from './cli-session.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const uiUrl = new URL('./ui/index.html', import.meta.url).href;
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
app.setName(metadata.productName || metadata.name);
let window, job, loading = false, providerId = 'mydbook', outputDir, stateFile, dataDir;
const accounts = new Map();
const testDirectory = !app.isPackaged && process.env.MYDBOOK_TEST_DATA_DIR;
if (testDirectory) { await mkdir(path.resolve(testDirectory), { recursive: true }); app.setPath('userData', path.resolve(testDirectory)); app.setPath('sessionData', path.resolve(testDirectory)); }
const cliPosition = process.argv.indexOf('--cli-session');
if (cliPosition !== -1) {
  const request = { pipe: process.argv[cliPosition + 1], provider: process.argv[process.argv.indexOf('--provider') + 1] };
  // Reuse the active process's encryption context. On a fresh Windows profile,
  // Chromium's encryption key may not yet have been persisted to Local State.
  if (!isSessionPipe(request.pipe) || !app.requestSingleInstanceLock({ cliSession: request })) app.quit();
  else app.whenReady().then(() => sendCliSession(request.pipe, request.provider, app.getPath('userData'))).catch(() => app.quit());
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
    const request = additionalData?.cliSession;
    if (request && isSessionPipe(request.pipe)) {
      app.whenReady().then(() => sendCliSession(request.pipe, request.provider, app.getPath('userData'), { quit: false })).catch(() => {});
      return;
    }
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    dataDir = testDirectory ? path.resolve(testDirectory) : app.getPath('userData');
    stateFile = path.join(dataDir, 'settings.json');
    outputDir = path.join(app.getPath('downloads'), 'MyDbook');
    try { const saved = JSON.parse(await readFile(stateFile, 'utf8')); if (typeof saved.outputDir === 'string' && path.isAbsolute(saved.outputDir)) outputDir = saved.outputDir; if (providerList.some(p => p.id === saved.provider)) providerId = saved.provider; } catch {}
    for (const provider of providerList) {
      const vault = new TokenVault(dataDir, safeStorage, process.platform, provider.id);
      let token = '', warning = '';
      try { token = await vault.load() || ''; } catch (error) { warning = userError(error); }
      accounts.set(provider.id, { vault, token, books: [], connected: false, remembered: Boolean(token), warning });
      await clearProviderSession(getProvider(provider.id));
    }
    const legacy = new TokenVault(dataDir, safeStorage);
    if (!accounts.get('mydbook').token) {
      try { const token = await legacy.load(); if (token) { await accounts.get('mydbook').vault.save(token); Object.assign(accounts.get('mydbook'), { token, remembered: true }); await legacy.forget(); } } catch {}
    }
    const selectedAccount = () => accounts.get(providerId);
    const safeBooks = (books, provider) => books.map(book => {
      let coverUrl = null;
      try { const u = new URL(book.coverUrl); if (provider.config.extraction.origins.includes(u.origin) && !u.search && !u.hash && !u.href.includes(selectedAccount().token)) coverUrl = u.href; } catch {}
      return { id: book.id, title: book.title, author: book.author, subtitle: book.subtitle, pagesCount: book.pagesCount, coverUrl };
    });
    const state = () => ({ version: app.getVersion(), name: app.getName(), provider: providerId, providers: providerList, connected: selectedAccount().connected, remembered: selectedAccount().remembered, canRemember: selectedAccount().vault.available(), outputDir, warning: selectedAccount().warning, books: safeBooks(selectedAccount().books, getProvider(providerId)) });
    const emitAccount = (extra = {}) => { if (window && !window.isDestroyed()) window.webContents.send('account:event', { ...state(), ...extra }); };
    const connect = async () => {
      const provider = getProvider(providerId), account = selectedAccount();
      if (!account.vault.available()) throw new ApiError('Archivio sicuro del sistema non disponibile. Il login automatico richiede safeStorage; puoi usare un token manuale senza Ricordami.');
      emitAccount({ connecting: true });
      const candidate = await loginProvider(window, provider);
      await account.vault.save(candidate);
      account.token = candidate; account.remembered = true;
      account.books = await provider.listBooks(candidate); account.connected = true;
      emitAccount({ connecting: false });
      return { ...state(), autoLogin: true };
    };
    const refresh = async (allowLogin = true) => {
      const provider = getProvider(providerId), account = selectedAccount();
      if (!account.token) return state();
      try { validateToken(account.token); account.books = await provider.listBooks(account.token); account.connected = true; return state(); }
      catch (error) {
        if ([401, 403].includes(error.status)) {
          account.token = ''; account.books = []; account.connected = false; account.remembered = false; await account.vault.forget();
          if (allowLogin) return connect();
        }
        throw error;
      }
    };
    const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiUrl) return { ok: false, message: 'Richiesta non autorizzata.' };
      try { return { ok: true, ...(await action(...args)) }; }
      catch (error) {
        if (['app:state', 'provider:select', 'provider:login', 'provider:disconnect', 'books:load', 'token:forget'].includes(channel)) emitAccount({ connecting: false });
        return { ok: false, message: userError(error, selectedAccount().token) };
      }
    });
    const exclusive = action => async (...args) => {
      if (job || loading) throw new ApiError('Attendi la fine dell’operazione in corso.');
      loading = true; try { return await action(...args); } finally { loading = false; }
    };
    handle('app:state', exclusive(() => refresh()));
    handle('provider:select', exclusive(async id => {
      getProvider(id); providerId = id;
      await mkdir(dataDir, { recursive: true }); await writeFile(stateFile, JSON.stringify({ outputDir, provider: providerId }), { mode: 0o600 });
      return refresh();
    }));
    handle('provider:login', exclusive(connect));
    handle('provider:disconnect', exclusive(async () => {
      const account = selectedAccount(); await account.vault.forget();
      if (providerId === 'mydbook') await legacy.forget();
      await clearProviderSession(getProvider(providerId));
      Object.assign(account, { token: '', books: [], connected: false, remembered: false }); return state();
    }));
    handle('token:forget', exclusive(async () => { await selectedAccount().vault.forget(); selectedAccount().remembered = false; return {}; }));
    handle('books:load', exclusive(async data => {
      const account = selectedAccount();
      if (!data || typeof data.token !== 'string' || typeof data.remember !== 'boolean') throw new ApiError('Dati di accesso non validi.');
      if (data.token) account.token = data.token.trim();
      if (!account.token) return connect();
      const result = await refresh();
      if (result.autoLogin) return result;
      if (data.remember) await account.vault.save(account.token); else await account.vault.forget();
      account.remembered = data.remember; return { ...result, remembered: data.remember };
    }));
    handle('output:choose', async () => {
      if (job || loading) throw new ApiError('Attendi o annulla l’operazione prima di cambiare cartella.');
      const result = await dialog.showOpenDialog(window, { title: 'Scegli dove salvare i PDF', defaultPath: outputDir, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled && result.filePaths[0]) { outputDir = result.filePaths[0]; await mkdir(dataDir, { recursive: true }); await writeFile(stateFile, JSON.stringify({ outputDir, provider: providerId }), { mode: 0o600 }); }
      return { outputDir };
    });
    handle('download:start', async data => {
      if (job || loading) throw new ApiError('È già in corso un’operazione.');
      if (!data || typeof data.compress !== 'boolean') throw new ApiError('Opzioni download non valide.');
      if (data.ocr !== undefined && typeof data.ocr !== 'boolean') throw new ApiError('Opzione OCR non valida.');
      parsePages(data.pageSelection);
      const account = selectedAccount(), provider = getProvider(providerId);
      const id = safeId(data.id), selected = account.books.find(book => book.id === id);
      if (!selected) throw new ApiError('Libro non trovato. Carica i tuoi libri e seleziona un titolo.');
      if (provider.config.downloadSupported === false) throw new ApiError(provider.config.limitation);
      try { validateToken(account.token); }
      catch (error) {
        if (![401, 403].includes(error.status)) throw error;
        loading = true;
        try { await account.vault.forget(); account.token = ''; account.connected = false; await connect(); }
        finally { loading = false; }
        throw new ApiError('Sessione aggiornata. Seleziona nuovamente il libro e premi Scarica PDF.');
      }
      const quality = validateJpegQuality(data.quality);
      const tmpDir = app.isPackaged || testDirectory ? path.join(dataDir, 'tmp') : path.resolve(directory, '../tmp');
      job = new DownloadJob({ provider: providerId, book: selected, token: account.token, outputDir, tmpDir, compress: data.compress, quality, ocr: providerId === 'mydbook' && data.ocr === true, pageSelection: data.pageSelection, firstDigitalPage: data.firstDigitalPage, firstBookPage: data.firstBookPage }, event => {
        if (['done', 'failed', 'cancelled'].includes(event.type)) job = null;
        if (window && !window.isDestroyed()) window.webContents.send('download:event', event);
        if (event.type === 'failed' && [401, 403].includes(event.status)) {
          loading = true; account.token = ''; account.connected = false; account.books = [];
          void account.vault.forget().then(connect).catch(error => emitAccount({ warning: userError(error), connecting: false })).finally(() => { loading = false; });
        }
      }); return {};
    });
    handle('download:cancel', async () => { job?.cancel(); return {}; });
    function createWindow() {
      window = new BrowserWindow({ width: 1160, height: 820, minWidth: 800, minHeight: 650, show: false, title: app.getName(), icon: path.join(directory, '..', metadata.appIcon), backgroundColor: '#f7f8f6',
        webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
      Menu.setApplicationMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.once('ready-to-show', () => window.show());
      window.on('close', event => { if (job) { event.preventDefault(); job.cancel(); const timer = setInterval(() => { if (!job) { clearInterval(timer); window.destroy(); app.quit(); } }, 100); } });
      window.loadURL(uiUrl);
    }
    createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
    app.on('before-quit', () => { job?.cancel(); for (const account of accounts.values()) { account.token = ''; account.books = []; } });
  }).catch(() => { dialog.showErrorBox('Avvio non riuscito', 'Impossibile avviare MyDbook Downloader. Verifica i permessi della cartella dei dati dell’app.'); app.quit(); });
}
