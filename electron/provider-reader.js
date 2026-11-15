import { BrowserWindow, session } from 'electron';
import { ApiError, validateToken } from '../src/api.js';
import { browserUserAgent } from './login-user-agent.js';
const readers = new Map();
export function closeProviderReader(id) { readers.get(id)?.close(); }
export async function openProviderReader(provider, token, book) {
  if (!provider.config.readerUrl) throw new ApiError('Apertura del lettore non disponibile per questo provider.');
  validateToken(token);
  const address = new URL(provider.config.readerUrl(book.id));
  if (address.origin !== provider.config.baseUrl) throw new ApiError('Indirizzo del lettore non valido.');
  closeProviderReader(provider.id);
  const profile = session.fromPartition(`reader-${provider.id}-${Date.now()}`, { cache: false });
  const auth = provider.config.auth;
  await profile.cookies.set({ url: provider.config.baseUrl, name: auth.cookieName, value: token, path: '/', secure: true, httpOnly: false });
  profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const reader = new BrowserWindow({ width: 1180, height: 850, title: book.title,
    webPreferences: { session: profile, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  readers.set(provider.id, reader);
  reader.webContents.setUserAgent(browserUserAgent(reader.webContents.getUserAgent()));
  reader.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  reader.webContents.on('will-attach-webview', event => event.preventDefault());
  reader.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== address.origin) event.preventDefault(); });
  reader.once('closed', () => {
    if (readers.get(provider.id) === reader) readers.delete(provider.id);
    void profile.clearStorageData().catch(() => {});
  });
  try { await reader.loadURL(address.href); }
  catch { if (!reader.isDestroyed()) reader.close(); throw new ApiError('Lettore non raggiungibile. Controlla la connessione e riprova.'); }
}
