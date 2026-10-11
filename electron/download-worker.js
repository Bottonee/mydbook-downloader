import { parentPort, workerData } from 'node:worker_threads';
import { downloadBook } from '../src/download.js';
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
  const target = await downloadBook({ ...workerData, signal: controller.signal, quiet: true, onProgress: progress });
  parentPort.postMessage({ type: 'done', target });
} catch (error) { parentPort.postMessage({ type: controller.signal.aborted ? 'cancelled' : 'failed', status: error.status, message: userError(error, workerData.token) }); }
finally { parentPort.close(); }
