import { CookieJar } from 'tough-cookie';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError } from '../api.js';
import { config } from '../config.js';

export const READER = 'https://webreader.zanichelli.it';
export const MICRO = 'https://microservices.kitaboo.eu';
export const DISTRIBUTION = 'https://zanichelliservices.kitaboo.eu';
export const BOOKTAB = 'https://web-booktab.zanichelli.it';
export const WEBMY = 'https://webmy.zanichelli.it';
const origins = new Set([READER, MICRO, DISTRIBUTION, BOOKTAB, WEBMY, 'https://my.zanichelli.it', 'https://idp.zanichelli.it']);
export function officialUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new ApiError('URL del lettore Zanichelli non valido.'); }
  if (!origins.has(url.origin) || url.username || url.password) throw new ApiError('Host del lettore Zanichelli non riconosciuto.');
  return url;
}
export function contentUrl(value, base) {
  if (!(value instanceof URL) && (typeof value !== 'string' || !value)) throw new ApiError('Percorso della risorsa Zanichelli assente.');
  const url = officialUrl(value, base);
  if (url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(base).pathname) || url.search || url.hash || /%2f|%5c/i.test(url.pathname)) throw new ApiError('Percorso della risorsa Zanichelli non valido.');
  return url;
}

// One cookie jar per book, never written to disk. Redirects do not carry custom auth headers.
export class ReaderHttp {
  constructor(idpToken, signal) {
    this.signal = signal; this.jar = new CookieJar();
    if (idpToken) for (const origin of ['https://my.zanichelli.it', WEBMY, BOOKTAB]) this.jar.setCookieSync(`token=${idpToken}; Secure; Path=/`, origin);
  }
  async request(value, { headers = {}, redirect = false, method = 'GET' } = {}) {
    const initial = officialUrl(value);
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      this.signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort();
      this.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, config.timeoutMs);
      const signal = controller.signal;
      let retry = false;
      try {
        let url = initial;
        for (let hop = 0; hop < 8; hop++) {
          const cookie = await this.jar.getCookieString(url.href);
          const response = await fetch(url, { method: hop === 0 ? method : 'GET', redirect: 'manual', signal, headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            Referer: READER + '/', ...(hop === 0 ? headers : {}), ...(cookie ? { Cookie: cookie } : {}),
          } });
          for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, url.href);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            const location = response.headers.get('location');
            if (!location) throw new ApiError('Il lettore Zanichelli non ha restituito una destinazione.');
            const next = officialUrl(location, url);
            if (next.origin === 'https://idp.zanichelli.it' || /\/login(?:\/|$)/.test(next.pathname)) throw new ApiError('Sessione Zanichelli scaduta: accedi nuovamente.', 401);
            if (!redirect || next.hash || (next.origin === BOOKTAB && !next.pathname.startsWith('/api/'))) return { location: next, url };
            url = next; continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            if ((response.status === 429 || response.status >= 500) && attempt < config.retries) { retry = true; break; }
            throw new ApiError(`Richiesta al lettore Zanichelli rifiutata (${response.status}).`, response.status);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          return { buffer, url };
        }
        if (!retry) throw new ApiError('Troppi reindirizzamenti del lettore Zanichelli.');
      } catch (error) {
        if (this.signal?.aborted) throw new ApiError('Download interrotto. Le pagine completate sono conservate.');
        if (error instanceof ApiError) throw error;
        if (attempt === config.retries) throw new ApiError('Errore di rete o timeout del lettore Zanichelli. Riprova il download.');
      } finally { clearTimeout(timer); this.signal?.removeEventListener('abort', abort); }
      await sleep(Math.min(30000, 500 * 2 ** attempt), undefined, { signal: this.signal });
    }
  }
  async buffer(url, options) { const result = await this.request(url, options); if (!result.buffer) throw new ApiError('Risorsa Zanichelli reindirizzata anziché scaricata.'); return result.buffer; }
  async text(url, options) { return (await this.buffer(url, options)).toString('utf8'); }
  async json(url, options) {
    const text = await this.text(url, options);
    try { return JSON.parse(text); } catch { throw new ApiError('Risposta del lettore Zanichelli non valida.'); }
  }
}
