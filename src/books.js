import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { imageToPng } from './images.js';
import cliProgress from 'cli-progress';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError } from './api.js';
import { config } from './config.js';

export function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new ApiError('Identificativo libro non valido.');
  return id;
}
export async function listBooks(api) {
  const data = await api.pageProps(config.libraryPath);
  const block = data.blocks?.find(b => b.blockConfiguration?.i18n?.key === config.libraryBlockKey);
  if (!Array.isArray(block?.blockConfiguration?.volumes) || !Array.isArray(data.user.bookcodes)) throw new ApiError('Struttura libreria cambiata: ripeti la discovery.');
  const allowed = new Set(data.user.bookcodes);
  return [...new Map(block.blockConfiguration.volumes.filter(b => allowed.has(b.bookcode)).map(b => [b.bookcode, { id: safeId(b.bookcode), title: b.title, subtitle: b.subtitle }])).values()];
}
export async function bookMetadata(api, book) {
  const data = await api.pageProps(config.bookPath(safeId(book.id)));
  if (!data.user.bookcodes?.includes(book.id)) throw new ApiError('Libro non presente nella tua libreria.', 403);
  if (!data.listPages?.length || !data.infoFixedPage) throw new ApiError('Questo libro non dispone di pagine a impaginazione fissa; formato non supportato.');
  const pages = data.listPages.map(p => ({ id: String(p.id), position: p.position }));
  if (pages.some(p => !p.id) || new Set(pages.map(p => p.id)).size !== pages.length) throw new ApiError('Elenco pagine incoerente: ripeti la discovery.');
  return { ...book, title: data.infoFixedPage.title || book.title, pages };
}
export const pageFilename = index => `${String(index + 1).padStart(6, '0')}.png`;
export async function validPage(file) {
  try { await imageToPng(await readFile(file)); return true; } catch { return false; }
}
export async function downloadPages(api, book, { quiet = false, limit = book.pages.length } = {}) {
  const folder = path.join(config.tmpDir, safeId(book.id));
  await mkdir(folder, { recursive: true });
  const manifestPath = path.join(folder, 'manifest.json');
  const manifest = { bookId: book.id, pageIds: book.pages.map(p => p.id) };
  let old;
  try { old = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new ApiError('Manifest di ripresa non valido: controlla la cartella tmp del libro.'); }
  if (old && JSON.stringify(old) !== JSON.stringify(manifest)) throw new ApiError('Elenco pagine diverso dal download precedente. Sposta la cartella tmp del libro e riprova.');
  if (!old) await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const bar = new cliProgress.SingleBar({ format: 'Pagine {bar} {value}/{total}', hideCursor: true }, cliProgress.Presets.shades_classic);
  if (!quiet) bar.start(limit, 0);
  let cursor = 0, done = 0, failure;
  const files = book.pages.slice(0, limit).map((_, i) => path.join(folder, pageFilename(i)));
  const worker = async () => {
    while (!failure && cursor < limit) {
      const i = cursor++, page = book.pages[i];
      try {
        api.signal?.throwIfAborted();
        if (!await validPage(files[i])) {
          await sleep(config.delayMs + Math.random() * 100, undefined, { signal: api.signal });
          // Recuperare l'URL a ogni pagina evita di conservare firme scadute su disco.
          const details = await api.json(config.pageDetailsPath(book.id, page.id));
          const item = details.pages?.find(p => String(p.id) === page.id);
          if (!item?.url) throw new ApiError(`Pagina mancante: ${page.id}.`);
          const bytes = await api.request(item.url, { binary: true });
          let png;
          try { png = await imageToPng(bytes); } catch { throw new ApiError(`Conversione immagine fallita alla pagina ${page.id}: controlla il formato e l'installazione Chromium (npx playwright install chromium).`); }
          await writeFile(files[i] + '.part', png);
          await rename(files[i] + '.part', files[i]);
        }
        done++; if (!quiet) bar.update(done);
      } catch (error) { failure ??= error; }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(config.concurrency, limit) }, worker));
    if (failure) throw failure;
    return files;
  } finally { if (!quiet) bar.stop(); }
}
