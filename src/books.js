import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { imageToPng } from './images.js';
import cliProgress from 'cli-progress';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError } from './api.js';
import { config } from './config.js';
import { PDFDocument } from 'pdf-lib';
import { safeId } from './providers/common.js';
import { listMydbookBooks, mydbookMetadata, downloadMydbookPage } from './providers/mydbook.js';

// Compatibility exports for existing CLI consumers; implementation lives in the provider.
export { safeId };
export const listBooks = listMydbookBooks;
export const bookMetadata = mydbookMetadata;
export const pageFilename = (index, type = 'png') => `${String(index + 1).padStart(6, '0')}.${type === 'pdf' ? 'pdf' : 'png'}`;
export async function validPage(file) {
  try {
    const bytes = await readFile(file);
    if (path.extname(file) === '.pdf') return (await PDFDocument.load(bytes)).getPageCount() === 1;
    await imageToPng(bytes); return true;
  } catch { return false; }
}
export async function downloadPages(api, book, { quiet = false, limit = book.pages.length, indices, tmpDir = config.tmpDir, onProgress = () => {} } = {}) {
  const chosen = indices ?? book.pages.slice(0, limit).map((_, i) => i);
  if (!Array.isArray(chosen) || !chosen.length || new Set(chosen).size !== chosen.length || chosen.some(i => !Number.isInteger(i) || i < 0 || i >= book.pages.length)) throw new ApiError('Selezione pagine non valida.');
  limit = chosen.length;
  const folder = path.join(tmpDir, safeId(book.id));
  await mkdir(folder, { recursive: true });
  const manifestPath = path.join(folder, 'manifest.json');
  const manifest = { bookId: book.id, pageIds: book.pages.map(p => p.id) };
  let old;
  try { old = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new ApiError('Manifest di ripresa non valido: controlla la cartella tmp del libro.'); }
  if (old && JSON.stringify(old) !== JSON.stringify(manifest)) throw new ApiError('Elenco pagine diverso dal download precedente. Sposta la cartella tmp del libro e riprova.');
  if (!old) await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const bar = new cliProgress.SingleBar({ format: 'Pagine {bar} {value}/{total}', hideCursor: true }, cliProgress.Presets.shades_classic);
  if (!quiet) bar.start(limit, 0);
  let cursor = 0, done = 0, downloaded = 0, resumed = 0, failure;
  onProgress({ phase: 'download', completed: 0, total: limit, downloaded, resumed });
  const files = chosen.map(index => path.join(folder, pageFilename(index, book.pages[index].type)));
  const worker = async () => {
    while (!failure && cursor < limit) {
      const i = cursor++, page = book.pages[chosen[i]];
      try {
        api.signal?.throwIfAborted();
        if (!await validPage(files[i])) {
          await sleep(config.delayMs + Math.random() * 100, undefined, { signal: api.signal });
          // Recuperare l'URL a ogni pagina evita di conservare firme scadute su disco.
          const resource = api.downloadPage ? await api.downloadPage({ ...page, bookId: book.id }) : await downloadMydbookPage(api, { ...page, bookId: book.id });
          const bytes = resource.buffer;
          let content;
          if (page.type === 'pdf') {
            try {
              if (resource.type !== 'pdf' || (await PDFDocument.load(bytes)).getPageCount() !== 1) throw new Error();
              content = bytes;
            } catch { throw new ApiError(`Pagina ${i + 1}: PDF mancante, danneggiato o composto da più pagine.`); }
          } else {
            try { content = await imageToPng(bytes); } catch { throw new ApiError(`Conversione immagine fallita alla pagina ${page.id}: controlla il formato e l'installazione Chromium (npx playwright install chromium).`); }
          }
          await writeFile(files[i] + '.part', content);
          await rename(files[i] + '.part', files[i]);
          downloaded++;
        } else resumed++;
        done++; if (!quiet) bar.update(done);
        onProgress({ phase: 'download', completed: done, total: limit, downloaded, resumed });
      } catch (error) { failure ??= error; }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(config.concurrency, limit) }, worker));
    if (failure) throw failure;
    return files;
  } finally { if (!quiet) bar.stop(); }
}
