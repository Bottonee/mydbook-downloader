import { Api, ApiError } from '../api.js';
import { bsmartConfig as config } from './bsmart.config.js';
import { extractConfiguredToken, normalizeBooks, safeId, validateWithLibrary } from './common.js';
import { decryptResource, fetchReaderKey } from './bsmart-crypto.js';
export const bsmart = {
  id: 'bsmart', name: 'bSmart', loginUrl: config.loginUrl, config,
  extractToken: session => extractConfiguredToken(session, config),
  isTokenValid: token => validateWithLibrary(bsmart, token),
  async listBooks(token, { signal } = {}) {
    const api = new Api(token, signal, config), fields = config.fields;
    const books = await api.json(config.libraryPath);
    const preactivations = await api.json(config.preactivationsPath);
    if (!Array.isArray(books) || !Array.isArray(preactivations)) throw new ApiError('Elenco libri bSmart non valido: il sito potrebbe essere cambiato.');
    const extra = preactivations.filter(group => group[fields.noBsmart] === false).flatMap(group => group[fields.preactivationBooks] || []);
    return normalizeBooks([...books, ...extra], fields, { provider: 'bsmart' });
  },
  async getMetadata(token, bookId, { signal } = {}) {
    safeId(bookId);
    const api = new Api(token, signal, config), fields = config.fields;
    const book = await api.json(config.bookPath(bookId));
    const revision = book?.[fields.edition]?.[fields.revision];
    if (String(book?.[fields.id]) !== String(bookId) || revision === undefined || revision === null) throw new ApiError('Metadati bSmart incompleti o libro non trovato.');
    const pages = [], seen = new Set();
    for (let batch = 1; batch <= 10000; batch++) {
      const resources = await api.json(`${config.resourcesPath(bookId, revision)}?per_page=${config.resourcesPerPage}&page=${batch}`);
      if (!Array.isArray(resources)) throw new ApiError('Elenco delle risorse bSmart non valido.');
      for (const resource of resources) {
        if (!Array.isArray(resource[fields.assets])) throw new ApiError('Risorsa bSmart priva di asset: impossibile verificare tutte le pagine.');
        for (const asset of resource[fields.assets]) {
          if (asset[fields.use] !== config.pageResources) continue;
          const id = String(asset[fields.id] ?? asset[fields.filename] ?? '');
          if (!id || seen.has(id) || typeof asset[fields.url] !== 'string') throw new ApiError('Identificativi o URL delle pagine bSmart mancanti/duplicati.');
          seen.add(id);
          // Preserve API resource/asset order, as in the reference downloader.
          pages.push({ id, position: pages.length, bookId: String(bookId), url: asset[fields.url], encrypted: asset[fields.encrypted] !== false, type: config.pageType });
        }
      }
      if (resources.length < config.resourcesPerPage) {
        if (!pages.length) throw new ApiError('Questo libro non offre pagine PDF scaricabili (page_pdf).');
        return { title: book[fields.title], pages };
      }
    }
    throw new ApiError('Troppe risorse bSmart: elenco pagine non completato.');
  },
  async getPages(token, bookId, options) { return (await bsmart.getMetadata(token, bookId, options)).pages; },
  async downloadPage(token, page, { signal } = {}) {
    const api = new Api(token, signal, config);
    const resource = await api.request(page.url, { binary: true, authenticate: false });
    const buffer = page.encrypted ? decryptResource(resource, await fetchReaderKey(api), config.encryption) : resource;
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new ApiError('Pagina bSmart non valida: formato modificato o decifratura non riuscita.');
    return { buffer, type: config.pageType };
  },
};
