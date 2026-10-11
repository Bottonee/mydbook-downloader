import dotenv from 'dotenv';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function loadToken() {
  dotenv.config({ path: '.env', override: false });
  return validateToken(process.env.MYDBOOK_TOKEN);
}
export function validateToken(value) {
  if (value !== undefined && typeof value !== 'string') throw new ApiError('Token non valido.');
  const token = value?.trim();
  if (!token) throw new ApiError('MYDBOOK_TOKEN assente: inseriscilo nel file .env.');
  if (token.length > 16384 || /[\s;\x00-\x1f]/.test(token)) throw new ApiError('MYDBOOK_TOKEN ha un formato non valido.');
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (payload.exp && payload.exp * 1000 <= Date.now()) throw new ApiError('Token scaduto: aggiorna MYDBOOK_TOKEN in .env.', 401);
  } catch (error) { if (error instanceof ApiError) throw error; }
  return token;
}

export class Api {
  constructor(token, signal) { this.token = token; this.signal = signal; }
  async request(path, { binary = false } = {}) {
    const initial = new URL(path, config.baseUrl);
    // Gli URL firmati osservati appartengono allo stesso host. Non inviare credenziali altrove.
    if (initial.origin !== config.baseUrl) throw new ApiError('Host delle pagine non riconosciuto: ripeti la discovery.');
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      this.signal?.throwIfAborted();
      let waitMs = Math.min(30000, 500 * 2 ** attempt) + Math.random() * 250;
      const controller = new AbortController();
      const abort = () => controller.abort();
      this.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, config.timeoutMs);
      try {
        let url = initial;
        let response;
        for (let hop = 0; hop < 8; hop++) {
          response = await fetch(url, {
            headers: {
              [config.auth.headerName]: `${config.auth.scheme} ${this.token}`,
              Cookie: `${config.auth.cookieName}=${this.token}`,
              Referer: `${config.baseUrl}/mydbook`,
              Accept: binary ? 'image/*,application/pdf' : 'application/json,text/html',
            }, redirect: 'manual', signal: controller.signal,
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new ApiError('Reindirizzamento senza destinazione.');
          url = new URL(location, url);
          if (url.origin !== config.baseUrl || url.pathname.includes('/login')) throw new ApiError('Sessione non valida: aggiorna MYDBOOK_TOKEN in .env.', 401);
          if (hop === 7) throw new ApiError('Troppi reindirizzamenti dal sito.');
        }
        if ([401, 403].includes(response.status)) {
          await response.body?.cancel();
          throw new ApiError('Token scaduto o accesso negato (401/403): aggiorna il token e verifica i permessi del libro.', response.status);
        }
        if (response.status === 404) { await response.body?.cancel(); throw new ApiError('Libro o pagina non trovato (404).', 404); }
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter) {
            const seconds = Number(retryAfter);
            const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(delay)) waitMs = Math.max(waitMs, Math.min(300000, delay));
          }
          await response.body?.cancel();
          if (attempt === config.retries) throw new ApiError(`Server non disponibile dopo i retry (${response.status}).`, response.status);
        } else {
          if (!response.ok) { await response.body?.cancel(); throw new ApiError(`Richiesta rifiutata (${response.status}).`, response.status); }
          return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
        }
      } catch (error) {
        if (this.signal?.aborted) throw new ApiError('Download interrotto. Le pagine completate sono conservate.');
        if (error instanceof ApiError) throw error;
        if (attempt === config.retries) throw new ApiError('Errore di rete o timeout dopo i retry. Riprova per riprendere il download.');
      } finally {
        clearTimeout(timer); this.signal?.removeEventListener('abort', abort);
      }
      await sleep(waitMs, undefined, { signal: this.signal });
    }
  }
  async json(path) {
    const text = await this.request(path);
    try { return JSON.parse(text); } catch { throw new ApiError('Risposta JSON non valida: ripeti la discovery.'); }
  }
  async pageProps(path) {
    const html = await this.request(path);
    const match = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new ApiError('Dati della pagina assenti: sessione non valida o sito modificato.');
    let data;
    try { data = JSON.parse(match[1]).props.pageProps; } catch { throw new ApiError('Dati della pagina non validi: ripeti la discovery.'); }
    if (!data?.user?.token) throw new ApiError('Sessione non autenticata: aggiorna MYDBOOK_TOKEN in .env.', 401);
    return data;
  }
}
