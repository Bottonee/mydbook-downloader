import { BrowserWindow, session } from 'electron';
import { ApiError } from '../src/api.js';
import { browserUserAgent } from './login-user-agent.js';

export function providerSession(provider) {
  return session.fromPartition(`persist:${provider.id}`, { cache: false });
}
export async function clearProviderSession(provider) {
  const ses = providerSession(provider);
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.closeAllConnections();
}

// No credential form access, response-body interception or password collection.
export async function loginProvider(parent, provider) {
  const ses = providerSession(provider), rules = provider.config.extraction;
  await ses.clearStorageData();
  const login = new BrowserWindow({ parent, modal: Boolean(parent), width: 980, height: 780, title: `Accedi a ${provider.name}`, show: false,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (provider.config.browserLogin) login.webContents.setUserAgent(browserUserAgent(login.webContents.getUserAgent()));
  const capturedHeaders = [], urls = [], rejectedTokens = new Set();
  let checking = false, settled = false, candidateRejected, resolveLogin, rejectLogin;
  const result = new Promise((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; });
  const source = {
    cookies: ses.cookies, capturedHeaders, urls, rejectedTokens,
    readStorage: async keys => {
      if (!keys.length || login.isDestroyed()) return null;
      if (!rules.origins.includes(new URL(login.webContents.getURL()).origin)) return null;
      return login.webContents.executeJavaScript(`(() => { const keys = ${JSON.stringify(rules.storageKeys)}; return { origin: location.origin, local: Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), session: Object.fromEntries(keys.map(k => [k, sessionStorage.getItem(k)])) }; })()`);
    },
  };
  const check = async () => {
    if (checking || settled || login.isDestroyed()) return;
    checking = true;
    try {
      const token = await provider.extractToken(source);
      if (token && token !== candidateRejected) {
        if (await provider.isTokenValid(token)) {
          if (!settled) { settled = true; resolveLogin(token); login.close(); }
        } else { candidateRejected = token; rejectedTokens.add(token); }
      }
    } catch { /* Do not display raw provider URLs or tokens, and allow login to continue. */ }
    finally { checking = false; }
  };
  ses.webRequest.onBeforeSendHeaders({ urls: rules.origins.map(origin => origin + '/*') }, (details, callback) => {
    // Pass through first: the browser request must never wait for token validation.
    callback({ requestHeaders: details.requestHeaders });
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).filter(([name]) => rules.headerNames.some(key => key.toLowerCase() === name.toLowerCase())));
    if (Object.keys(headers).length) { capturedHeaders.push({ url: details.url, headers }); if (capturedHeaders.length > 20) capturedHeaders.shift(); void check(); }
  });
  const changed = () => { void check(); };
  ses.cookies.on('changed', changed);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  login.webContents.on('will-attach-webview', event => event.preventDefault());
  login.webContents.on('will-navigate', (event, address) => { if (!address.startsWith('https://')) event.preventDefault(); });
  // Official federated login may navigate across identity-provider origins. They are never token sources.
  login.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void login.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  login.webContents.on('did-navigate', (_event, address) => { urls.push(address); if (urls.length > 20) urls.shift(); void check(); });
  login.webContents.on('did-navigate-in-page', (_event, address) => { urls.push(address); void check(); });
  login.webContents.on('did-finish-load', changed);
  login.once('ready-to-show', () => login.show());
  login.once('closed', () => { if (!settled) { settled = true; rejectLogin(new ApiError('Accesso annullato. Nessuna credenziale salvata.')); } });
  const timer = setInterval(changed, 1200);
  void login.loadURL(provider.loginUrl).catch(error => {
    // bSmart redirects from its reader to sign_in before the initial document finishes loading.
    // Chromium reports ERR_ABORTED for the superseded navigation, not a failed login.
    if (error.code === 'ERR_ABORTED' || error.errno === -3) return;
    if (!settled) { settled = true; rejectLogin(new ApiError('Pagina di accesso non raggiungibile. Controlla la connessione.')); login.close(); }
  });
  try { return await result; }
  finally {
    settled = true; clearInterval(timer); ses.cookies.removeListener('changed', changed);
    ses.webRequest.onBeforeSendHeaders(null);
    capturedHeaders.length = 0; urls.length = 0; rejectedTokens.clear();
    // Only safeStorage vaults survive the flow. Chromium profiles are not used as a token archive.
    await ses.clearStorageData(); await ses.clearCache();
    if (!login.isDestroyed()) login.destroy();
  }
}
