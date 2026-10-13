import ZipStream from 'zip-stream';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { ApiError } from '../api.js';
import { sanitizeTitle } from '../pdf.js';
import { contentUrl } from './zanichelli-http.js';

export async function saveEpub(metadata, { outputDir, signal, onProgress = () => {} }) {
  const { http, root, base, entries, opfPath, opfText, containerText } = metadata.context;
  await mkdir(outputDir, { recursive: true });
  const target = path.resolve(outputDir, sanitizeTitle(metadata.title) + '.epub');
  const output = createWriteStream(target + '.part', { mode: 0o600 });
  const archive = new ZipStream({ store: true });
  const complete = finished(output); complete.catch(() => {});
  const abort = () => { archive.destroy(new Error('Annullato')); output.destroy(new Error('Annullato')); };
  signal?.addEventListener('abort', abort, { once: true });
  archive.on('error', error => output.destroy(error));
  output.on('error', () => archive.destroy());
  archive.pipe(output);
  const names = new Set();
  const add = async (name, buffer) => {
    signal?.throwIfAborted();
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f]/.test(name)) throw new ApiError('Percorso EPUB Zanichelli non valido.');
    if (names.has(name)) return;
    names.add(name);
    await new Promise((resolve, reject) => archive.entry(buffer, { name, store: true }, error => error ? reject(error) : resolve()));
  };
  try {
    signal?.throwIfAborted();
    await add('mimetype', Buffer.from('application/epub+zip'));
    await add('META-INF/container.xml', Buffer.from(containerText));
    await add(opfPath, Buffer.from(opfText));
    onProgress({ phase: 'epub', completed: 0, total: entries.length });
    for (const [i, entry] of entries.entries()) {
      signal?.throwIfAborted();
      const url = contentUrl(entry.$?.href, base);
      contentUrl(url.href, root);
      const name = decodeURIComponent(url.pathname.slice(new URL(root).pathname.length));
      await add(name, await http.buffer(url));
      onProgress({ phase: 'epub', completed: i + 1, total: entries.length });
    }
    onProgress({ phase: 'saving', completed: 0, total: entries.length });
    archive.finalize(); await complete;
    signal?.throwIfAborted();
    await rename(target + '.part', target);
    onProgress({ phase: 'complete', completed: entries.length, total: entries.length });
    return target;
  } catch (error) {
    archive.destroy(); output.destroy(); await complete.catch(() => {});
    await unlink(target + '.part').catch(() => {});
    if (signal?.aborted) throw new ApiError('Download EPUB interrotto. Riavvialo per scaricare il libro.');
    if (error instanceof ApiError || error.code === 'ENOSPC' || error.code === 'EACCES' || error.code === 'EPERM') throw error;
    throw new ApiError('Creazione EPUB Zanichelli non riuscita.');
  } finally { signal?.removeEventListener('abort', abort); }
}
