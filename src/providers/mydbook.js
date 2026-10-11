import { Api, ApiError } from '../api.js';
import { config } from '../config.js';
import { mydbookConfig } from './mydbook.config.js';
import { extractConfiguredToken, normalizeBooks, safeId, validateWithLibrary } from './common.js';

export async function listMydbookBooks(api) {
  const fields = mydbookConfig.fields;
  const data = await api.pageProps(config.libraryPath);
  const block = data[fields.blocks]?.find(b => b[fields.blockConfiguration]?.[fields.i18n]?.[fields.blockKey] === config.libraryBlockKey);
  if (!Array.isArray(data[fields.user]?.[fields.allowed])) throw new ApiError('Struttura libreria cambiata: ripeti la discovery.');
  return normalizeBooks(block?.[fields.blockConfiguration]?.[fields.books], fields, { allowed: new Set(data[fields.user][fields.allowed]), provider: 'mydbook' });
}
export async function mydbookMetadata(api, book) {
  const fields = mydbookConfig.fields;
  const data = await api.pageProps(config.bookPath(safeId(book.id)));
  if (!data[fields.user][fields.allowed]?.includes(book.id)) throw new ApiError('Libro non presente nella tua libreria.', 403);
  if (!data[fields.pages]?.length || !data[fields.metadata]) throw new ApiError('Questo libro non dispone di pagine a impaginazione fissa; formato non supportato.');
  const pages = data[fields.pages].map(p => ({ id: String(p[fields.pageId] ?? ''), position: p[fields.position], bookId: book.id }));
  if (pages.some(p => !p.id) || new Set(pages.map(p => p.id)).size !== pages.length) throw new ApiError('Elenco pagine incoerente: ripeti la discovery.');
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
  getMetadata: (token, bookId, { signal } = {}) => mydbookMetadata(new Api(token, signal), { id: safeId(bookId) }),
  getPages: async (token, bookId, options) => (await mydbook.getMetadata(token, bookId, options)).pages,
  downloadPage: (token, page, { signal } = {}) => downloadMydbookPage(new Api(token, signal), page),
};
