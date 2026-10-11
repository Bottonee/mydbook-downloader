import { parentPort, workerData } from 'node:worker_threads';
import { Api } from '../src/api.js';
import { bookMetadata, downloadPages } from '../src/books.js';
import { mergePdf } from '../src/pdf.js';
import { setImageConverter } from '../src/images.js';
import { userError } from './errors.js';
const controller = new AbortController();
const pending = new Map(); let sequence = 0;
parentPort.on('message', message => {
  if (message.type === 'cancel') { controller.abort(); for (const p of pending.values()) p.reject(new Error('Annullato')); pending.clear(); }
  if (message.type === 'converted') { const p = pending.get(message.id); if (!p) return; pending.delete(message.id); message.error ? p.reject(new Error('Conversione fallita')) : p.resolve(message.result); }
});
setImageConverter(payload => new Promise((resolve, reject) => {
  if (controller.signal.aborted) { reject(new Error('Annullato')); return; }
  const id = ++sequence; pending.set(id, { resolve, reject }); parentPort.postMessage({ type: 'convert', id, payload });
}));
const progress = data => parentPort.postMessage({ type: 'progress', ...data });
try {
  progress({ phase: 'metadata', completed: 0, total: 0 });
  const api = new Api(workerData.token, controller.signal);
  const book = await bookMetadata(api, workerData.book);
  const limit = workerData.limit ?? book.pages.length;
  const files = await downloadPages(api, book, { quiet: true, tmpDir: workerData.tmpDir, limit, onProgress: progress });
  const target = await mergePdf({ ...book, pages: book.pages.slice(0, limit) }, files, { quiet: true, signal: controller.signal, compress: workerData.compress, quality: workerData.quality, outputDir: workerData.outputDir, sample: limit < book.pages.length, onProgress: progress });
  parentPort.postMessage({ type: 'done', target });
} catch (error) { parentPort.postMessage({ type: controller.signal.aborted ? 'cancelled' : 'failed', message: userError(error, workerData.token) }); }
finally { parentPort.close(); }
