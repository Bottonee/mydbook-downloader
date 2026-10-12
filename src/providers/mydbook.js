import { Api, ApiError } from '../api.js';
import { config } from '../config.js';
import { mydbookConfig } from './mydbook.config.js';
import { extractConfiguredToken, normalizeBooks, safeId, validateWithLibrary } from './common.js';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function listMydbookBooks(api) {
  const fields = mydbookConfig.fields;
  const data = await api.pageProps(config.libraryPath);
  const block = data[fields.blocks]?.find(b => b[fields.blockConfiguration]?.[fields.i18n]?.[fields.blockKey] === config.libraryBlockKey);
  if (!Array.isArray(data[fields.user]?.[fields.allowed])) throw new ApiError('Struttura libreria cambiata: ripeti la discovery.');
  return normalizeBooks(block?.[fields.blockConfiguration]?.[fields.books], fields, { allowed: new Set(data[fields.user][fields.allowed]), provider: 'mydbook' });
}
export async function mydbookMetadata(api, book, { resolveLabels = false, labelsCache, onProgress = () => {} } = {}) {
  const fields = mydbookConfig.fields;
  const data = await api.pageProps(config.bookPath(safeId(book.id)));
  if (!data[fields.user][fields.allowed]?.includes(book.id)) throw new ApiError('Libro non presente nella tua libreria.', 403);
  if (!data[fields.pages]?.length || !data[fields.metadata]) throw new ApiError('Questo libro non dispone di pagine a impaginazione fissa; formato non supportato.');
  const visible = new Map((data[fields.metadata][fields.detailsPages] || []).map(page => [String(page[fields.pageId]), page[fields.title]]));
  const pages = data[fields.pages].map(p => ({ id: String(p[fields.pageId] ?? ''), position: p[fields.position], bookId: book.id, label: p[fields.title] ?? visible.get(String(p[fields.pageId])) }));
  if (pages.some(p => !p.id) || new Set(pages.map(p => p.id)).size !== pages.length) throw new ApiError('Elenco pagine incoerente: ripeti la discovery.');
  if (resolveLabels) {
    const ids = pages.map(page => page.id);
    let cached;
    try { cached = JSON.parse(await readFile(labelsCache, 'utf8')); } catch {}
    if (cached && JSON.stringify(cached.pageIds) === JSON.stringify(ids) && cached.labels?.length === pages.length && cached.labels.every(label => typeof label === 'string')) {
      pages.forEach((page, index) => { page.label = cached.labels[index]; });
    } else {
      let cursor = 0, completed = 0, failure;
      onProgress({ phase: 'numbering', completed: 0, total: pages.length });
      const resolve = async () => {
        while (!failure && cursor < pages.length) {
          const page = pages[cursor++];
          try {
            api.signal?.throwIfAborted();
            if (page.label === undefined) {
              await sleep(config.delayMs, undefined, { signal: api.signal });
              const details = await api.json(config.pageDetailsPath(book.id, page.id));
              const item = details[fields.detailsPages]?.find(item => String(item[fields.pageId]) === page.id);
              page.label = typeof item?.[fields.title] === 'string' ? item[fields.title] : '';
            }
            completed++; onProgress({ phase: 'numbering', completed, total: pages.length });
          } catch (error) { failure ??= error; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(config.concurrency, pages.length) }, resolve));
      if (failure) throw failure;
      if (labelsCache) {
        await mkdir(path.dirname(labelsCache), { recursive: true });
        await writeFile(labelsCache + '.part', JSON.stringify({ pageIds: ids, labels: pages.map(page => String(page.label ?? '')) }));
        await rename(labelsCache + '.part', labelsCache);
      }
    }
  }
  return { ...book, title: data[fields.metadata][fields.title] || book.title, pages };
}
export async function downloadMydbookPage(api, page) {
  const fields = mydbookConfig.fields;
  const details = await api.json(config.pageDetailsPath(safeId(page.bookId), page.id));
  const item = details[fields.detailsPages]?.find(p => String(p[fields.pageId]) === page.id);
  if (!item?.[fields.pageUrl]) throw new ApiError(`Pagina mancante: ${page.id}.`);
  const buffer = await api.request(item[fields.pageUrl], { binary: true });
  const type = buffer.subarray(0, 4).toString() === 'RIFF' ? 'webp' : buffer[0] === 0xff ? 'jpg' : buffer[0] === 0x89 ? 'png' : 'unknown';
  return { buffer, type };
}
export const mydbook = {
  id: 'mydbook', name: 'MyDBook', loginUrl: mydbookConfig.loginUrl, config: mydbookConfig,
  extractToken: session => extractConfiguredToken(session, mydbookConfig),
  isTokenValid: token => validateWithLibrary(mydbook, token),
  listBooks: (token, { signal } = {}) => listMydbookBooks(new Api(token, signal)),
  getMetadata: (token, bookId, options = {}) => mydbookMetadata(new Api(token, options.signal), { id: safeId(bookId) }, options),
  getPages: async (token, bookId, options) => (await mydbook.getMetadata(token, bookId, options)).pages,
  downloadPage: (token, page, { signal } = {}) => downloadMydbookPage(new Api(token, signal), page),
};
