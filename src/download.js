import path from 'node:path';
import { access } from 'node:fs/promises';
import { ApiError } from './api.js';
import { config } from './config.js';
import { downloadPages } from './books.js';
import { mergePdf } from './pdf.js';
import { getProvider } from './providers/index.js';
import { safeId } from './providers/common.js';

// A single orchestration pipeline for desktop and CLI, independent of the provider transport.
export async function downloadBook({ provider: id = 'mydbook', token, book, signal, tmpDir = config.tmpDir, outputDir = config.outputDir, compress = false, quality = 80, limit, quiet = false, onProgress = () => {} }) {
  const provider = getProvider(id);
  safeId(book.id);
  onProgress({ phase: 'metadata', completed: 0, total: 0 });
  const metadata = provider.getMetadata ? await provider.getMetadata(token, book.id, { signal }) : { pages: await provider.getPages(token, book.id, { signal }) };
  const pages = metadata.pages;
  const full = { ...book, ...metadata, provider: id, pages };
  const count = limit ?? pages.length;
  if (!Number.isInteger(count) || count < 1 || count > pages.length) throw new ApiError('Il numero di pagine deve essere un intero tra 1 e il totale.');
  const transport = { signal, downloadPage: page => provider.downloadPage(token, page, { signal }) };
  let cacheDir = path.join(tmpDir, id);
  if (id === 'mydbook') {
    // Preserve downloads made before provider folders were introduced.
    try { await access(path.join(tmpDir, book.id, 'manifest.json')); cacheDir = tmpDir; } catch {}
  }
  const files = await downloadPages(transport, full, { quiet, tmpDir: cacheDir, limit: count, onProgress });
  return mergePdf({ ...full, pages: pages.slice(0, count) }, files, { quiet, signal, compress, quality, outputDir: path.join(outputDir, id), sample: count < pages.length, onProgress });
}
