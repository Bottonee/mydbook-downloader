import { ApiError, validateToken } from '../api.js';

export function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new ApiError('Identificativo libro non valido.');
  return id;
}

// Only configured keys and official origins are considered; OAuth tokens for other services are ignored.
export async function extractConfiguredToken(session, config) {
  const rules = config.extraction;
  for (const origin of rules.origins) {
    for (const cookie of await session.cookies.get({ url: origin })) {
      if (rules.cookieNames.includes(cookie.name) && cookie.value && !session.rejectedTokens?.has(cookie.value)) return cookie.value;
    }
  }
  const snapshot = await session.readStorage?.(rules.storageKeys);
  if (snapshot && rules.origins.includes(snapshot.origin)) {
    for (const key of rules.storageKeys) {
      const value = snapshot.local?.[key] || snapshot.session?.[key];
      if (typeof value === 'string' && value && !session.rejectedTokens?.has(value)) return value;
    }
  }
  for (const record of [...(session.capturedHeaders || [])].reverse()) {
    const url = new URL(record.url);
    if (!rules.origins.includes(url.origin)) continue;
    for (const [name, value] of Object.entries(record.headers)) {
      if (!rules.headerNames.some(key => key.toLowerCase() === name.toLowerCase())) continue;
      if (typeof value !== 'string') continue;
      if (!rules.headerScheme && !session.rejectedTokens?.has(value)) return value;
      const prefix = rules.headerScheme + ' ';
      if (value.startsWith(prefix) && !session.rejectedTokens?.has(value.slice(prefix.length))) return value.slice(prefix.length);
    }
  }
  for (const address of session.urls || []) {
    const url = new URL(address);
    if (!rules.origins.includes(url.origin)) continue;
    for (const key of rules.urlKeys) { const value = url.searchParams.get(key); if (value) return value; }
  }
  return null;
}

export async function validateWithLibrary(provider, token) {
  try { validateToken(token); } catch (error) { if (error instanceof ApiError) return false; throw error; }
  try { await provider.listBooks(token); return true; }
  catch (error) { if (error.status === 401 || error.status === 403) return false; throw error; }
}

export function normalizeBooks(items, fields, { allowed, provider } = {}) {
  if (!Array.isArray(items)) throw new ApiError('Struttura libreria cambiata: ripeti la discovery.');
  const result = new Map();
  for (const item of items) {
    if (!item || (allowed && !allowed.has(item[fields.id]))) continue;
    const id = safeId(String(item[fields.id] ?? ''));
    if (typeof item[fields.title] !== 'string') throw new ApiError('Titolo libro assente: ripeti la discovery.');
    const authors = item[fields.authors];
    const book = { id, title: item[fields.title], provider };
    if (fields.subtitle && item[fields.subtitle]) book.subtitle = item[fields.subtitle];
    if (typeof authors === 'string') book.author = authors;
    // Author object field names remain unconfirmed for bSmart; do not guess them.
    if (Array.isArray(authors) && authors.every(a => typeof a === 'string')) book.author = authors.join(', ');
    if (fields.cover && typeof item[fields.cover] === 'string') book.cover = item[fields.cover];
    book.coverUrl = book.cover || null;
    if (Number.isInteger(item[fields.pagesCount]) && item[fields.pagesCount] >= 0) book.pagesCount = item[fields.pagesCount];
    result.set(id, book);
  }
  return [...result.values()];
}
