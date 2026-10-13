import { Api, ApiError } from '../api.js';
import { zanichelliConfig as config } from './zanichelli.config.js';
import { normalizeBooks, safeId, validateWithLibrary } from './common.js';
import { decodeSession, extractSession } from './zanichelli-session.js';
import { openReader, downloadReaderPage } from './zanichelli-reader.js';
import { saveEpub } from './zanichelli-epub.js';
import { bundleVolumes, volumeTitle, readerVolumes } from './zanichelli-volumes.js';

async function catalogBooks(token, { signal } = {}) {
  const response = await new Api(decodeSession(token).myzToken, signal, config).json(config.libraryPath);
  const licenses = response?.[config.libraryRoot];
  if (!Array.isArray(licenses)) throw new ApiError('Elenco licenze Zanichelli non valido: ripeti la discovery.');
  const volumes = licenses.map(license => license?.[config.volumeField]).filter(volume => volume && typeof volume[config.ebookUrlField] === 'string' && volume[config.ebookUrlField] && volume[config.ebookInfoField]?.[config.fields.ebookId]);
  const unique = new Map();
  for (const volume of volumes) unique.set(`${volume.isbn}:${volume.ereader_info.id}`, volume);
  const counts = new Map();
  for (const volume of unique.values()) counts.set(String(volume.isbn), (counts.get(String(volume.isbn)) || 0) + 1);
  return [...unique.values()].map(volume => {
    const isbn = safeId(String(volume.isbn));
    const ebookId = safeId(String(volume.ereader_info.id));
    const id = counts.get(isbn) > 1 ? `${isbn}__ebook_${ebookId}` : isbn;
    const opera = volume.opera?.title;
    const title = typeof opera === 'string' && opera.trim() && !volume.title?.toLocaleLowerCase('it').startsWith(opera.toLocaleLowerCase('it')) ? `${opera} — ${volume.title}` : volume.title;
    const [book] = normalizeBooks([{ ...volume, isbn: id, title }], config.fields, { provider: config.id });
    return { ...book, isbn, ebookId, readerUrl: volume[config.ebookUrlField] };
  });
}

export const zanichelli = {
  id: config.id, name: config.name, loginUrl: config.loginUrl, config,
  extractToken: source => extractSession(source, config),
  isTokenValid: token => validateWithLibrary({ listBooks: catalogBooks }, token),
  async listBooks(token, { signal } = {}) {
    const books = await catalogBooks(token, { signal });
    const result = [];
    for (const book of books) {
      signal?.throwIfAborted();
      const bundle = bundleVolumes(book.title);
      if (!bundle || !decodeSession(token).idpToken) { result.push(book); continue; }
      const metadata = await openReader(token, book, signal, { loadKey: false });
      const ranges = await readerVolumes(metadata, bundle.letters);
      for (const range of ranges) result.push({ ...book, id: `${book.id}__volume_${range.letter}`, title: volumeTitle(book.title, range.letter), subtitle: 'Volume della confezione ' + bundle.letters.map(letter => bundle.number + letter).join('+'), pagesCount: range.end - range.start });
    }
    return result;
  },
  async getMetadata(token, bookId, { signal } = {}) {
    safeId(bookId);
    const books = await catalogBooks(token, { signal });
    const book = books.find(book => book.id === bookId || bundleVolumes(book.title)?.letters.some(letter => bookId === `${book.id}__volume_${letter}`));
    if (!book) throw new ApiError('Libro Zanichelli non presente nelle tue licenze.', 403);
    const metadata = await openReader(token, book, signal);
    if (book.id === bookId) return metadata;
    const bundle = bundleVolumes(book.title);
    const ranges = await readerVolumes(metadata, bundle.letters);
    const range = ranges.find(range => bookId === `${book.id}__volume_${range.letter}`);
    if (!range) throw new ApiError('Volume Zanichelli non presente nell’indice del libro.', 404);
    return { ...metadata, title: volumeTitle(book.title, range.letter), pages: metadata.pages.slice(range.start, range.end) };
  },
  async getPages(token, bookId, options) { return (await zanichelli.getMetadata(token, bookId, options)).pages; },
  async downloadPage(_token, page, { signal } = {}) { signal?.throwIfAborted(); return downloadReaderPage(page); },
  saveEpub,
};
