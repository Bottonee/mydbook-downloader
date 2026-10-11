import { createRequire } from 'node:module';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { ApiError } from './api.js';

const require = createRequire(import.meta.url);
const physicalPath = value => value.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const interrupted = () => new ApiError('OCR interrotto. Le pagine e i risultati completati sono conservati.');
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(interrupted());
  return new Promise((resolve, reject) => {
    const abort = () => reject(interrupted());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// One local worker per book. No language/model downloads and no remote OCR services.
export function createOcr({ signal, onProgress = () => {} } = {}) {
  let worker, starting, closed = false;
  const abort = () => { closed = true; void worker?.terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  async function getWorker() {
    if (signal?.aborted || closed) throw interrupted();
    if (!starting) starting = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const modelDir = physicalPath(fileURLToPath(new URL('../build/ocr', import.meta.url)));
      try { await Promise.all(['ita', 'eng'].map(code => readFile(path.join(modelDir, `${code}.traineddata.gz`)))); }
      catch { throw new ApiError('Modelli OCR locali mancanti. Esegui npm run ocr:prepare oppure reinstalla l’app.'); }
      if (closed || signal?.aborted) throw interrupted();
      worker = await createWorker('ita+eng', 1, {
        workerPath: physicalPath(require.resolve('tesseract.js/src/worker-script/node/index.js')),
        langPath: modelDir,
        cacheMethod: 'none', logger: () => {}, errorHandler: () => {},
      }, { user_words_suffix: '', user_patterns_suffix: '' });
      if (closed || signal?.aborted) { await worker.terminate(); throw interrupted(); }
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '300' });
      return worker;
    })();
    return abortable(starting, signal);
  }
  return {
    async recognize(bytes, file, index, total) {
      if (closed || signal?.aborted) throw interrupted();
      const hash = createHash('sha256').update(bytes).digest('hex');
      const cache = `${file}.ocr-ita-eng-v1-${hash}.pdf`;
      onProgress({ phase: 'ocr', completed: index, total });
      try {
        const saved = await readFile(cache);
        if ((await PDFDocument.load(saved)).getPageCount() === 1) return saved;
      } catch {}
      try {
        const engine = await getWorker();
        const { data } = await abortable(engine.recognize(bytes, { pdfTextOnly: true }, { pdf: true, text: false }), signal);
        if (closed || signal?.aborted) throw interrupted();
        const pdf = Buffer.from(data.pdf || []);
        if ((await PDFDocument.load(pdf)).getPageCount() !== 1) throw new Error();
        await writeFile(cache + '.part', pdf);
        if (closed || signal?.aborted) throw interrupted();
        await rename(cache + '.part', cache);
        return pdf;
      } catch (error) {
        if (closed || signal?.aborted) throw interrupted();
        if (error instanceof ApiError) throw error;
        throw new ApiError(`OCR non riuscito alla pagina ${index + 1}. Le immagini scaricate sono conservate; riprova o disattiva l’OCR.`);
      }
    },
    async close() {
      closed = true;
      signal?.removeEventListener('abort', abort);
      if (starting) await starting.catch(() => {});
      await worker?.terminate();
    },
  };
}
