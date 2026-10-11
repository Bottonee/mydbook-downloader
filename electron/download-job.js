import { Worker } from 'node:worker_threads';
import { ImageConverter } from './image-converter.js';
export class DownloadJob {
  constructor(data, onEvent, workerOptions = {}) {
    this.onEvent = onEvent; this.finished = false; this.cancelling = false; this.converter = new ImageConverter();
    this.worker = new Worker(new URL('./download-worker.js', import.meta.url), { ...workerOptions, workerData: data });
    this.worker.on('message', message => {
      if (this.finished) return;
      if (message.type === 'convert') {
        if (this.cancelling) { this.worker.postMessage({ type: 'converted', id: message.id, error: true }); return; }
        this.converter.convert(message.payload).then(result => { if (!this.finished && !this.cancelling) this.worker.postMessage({ type: 'converted', id: message.id, result }); })
          .catch(() => { if (!this.finished) this.worker.postMessage({ type: 'converted', id: message.id, error: true }); });
      } else if (message.type === 'progress') { if (!this.cancelling) onEvent(message); }
      else this.finish(this.cancelling ? { type: 'cancelled' } : message);
    });
    this.worker.on('error', () => this.finish({ type: this.cancelling ? 'cancelled' : 'failed', message: 'Il processo di download si è interrotto. Le pagine completate sono conservate; riprova.' }));
    this.worker.on('exit', () => { if (!this.finished) this.finish({ type: this.cancelling ? 'cancelled' : 'failed', message: 'Download interrotto. Riprova per riprendere dalle pagine salvate.' }); });
  }
  finish(message) { if (this.finished) return; this.finished = true; clearTimeout(this.cancelTimer); this.converter.close(); this.onEvent(message); }
  cancel() {
    if (this.finished || this.cancelling) return;
    this.cancelling = true; this.worker.postMessage({ type: 'cancel' }); this.converter.close();
    // Il worker permette di interrompere anche pdf.save() durante il lavoro sulla CPU.
    this.cancelTimer = setTimeout(async () => { await this.worker.terminate(); this.finish({ type: 'cancelled' }); }, 2000);
  }
}
