import path from 'node:path';
import { access } from 'node:fs/promises';
import { ApiError } from './api.js';
import { config } from './config.js';
import { downloadPages } from './books.js';
import { mergePdf } from './pdf.js';
import { getProvider } from './providers/index.js';
import { safeId } from './providers/common.js';
import { parsePages, selectPages } from './page-selection.js';

// A single orchestration pipeline for desktop and CLI, independent of the provider transport.
export async function downloadBook({ provider: id = 'mydbook', token, book, signal, tmpDir = config.tmpDir, outputDir = config.outputDir, compress = false, quality = 80, ocr = false, limit, pageSelection, firstDigitalPage, firstBookPage = 1, quiet = false, onProgress = () => {} }) {
  const provider = getProvider(id);
  const requested = parsePages(pageSelection);
  if (requested && limit !== undefined) throw new ApiError('Non combinare un campione con la selezione di pagine.');
  safeId(book.id);
  let cacheDir = path.join(tmpDir, id);
  if (id === 'mydbook') {
    try { await access(path.join(tmpDir, book.id, 'manifest.json')); cacheDir = tmpDir; } catch {}
  }
  onProgress({ phase: 'metadata', completed: 0, total: 0 });
  const resolveLabels = Boolean(requested && id === 'mydbook' && (firstDigitalPage === undefined || firstDigitalPage === null || firstDigitalPage === ''));
  if (resolveLabels && !quiet) console.log('Lettura delle etichette di pagina MyDBook. La prima volta può richiedere alcuni minuti.');
  const metadata = provider.getMetadata ? await provider.getMetadata(token, book.id, { signal, resolveLabels, labelsCache: path.join(cacheDir, book.id, 'page-labels.json'), onProgress }) : { pages: await provider.getPages(token, book.id, { signal }) };
  if (metadata.format === 'epub') {
    if (requested || limit !== undefined) throw new ApiError('I libri liquidi Zanichelli vengono salvati in EPUB: campioni e selezione di pagine non sono disponibili.');
    if (compress || ocr) throw new ApiError('Compressione e OCR non sono disponibili per i libri EPUB.');
    return provider.saveEpub(metadata, { outputDir: path.join(outputDir, id), signal, onProgress });
  }
  const pages = metadata.pages;
  const full = { ...book, ...metadata, provider: id, pages };
  const selection = selectPages(pages, pageSelection, { firstDigitalPage, firstBookPage });
  const count = limit ?? pages.length;
  if (!Number.isInteger(count) || count < 1 || count > pages.length) throw new ApiError('Il numero di pagine deve essere un intero tra 1 e il totale.');
  const transport = { signal, downloadPage: page => provider.downloadPage(token, page, { signal }) };
  const indices = requested ? selection.indices : pages.slice(0, count).map((_, i) => i);
  const files = await downloadPages(transport, full, { quiet, tmpDir: cacheDir, indices, onProgress });
  return mergePdf({ ...full, pages: requested ? selection.pages : pages.slice(0, count) }, files, { quiet, signal, compress, quality, ocr: id === 'mydbook' && ocr, outputDir: path.join(outputDir, id), sample: !requested && count < pages.length, selectionSuffix: selection.suffix, onProgress });
}
