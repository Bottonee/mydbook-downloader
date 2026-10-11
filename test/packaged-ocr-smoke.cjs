const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { readFile, readdir } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
(async () => {
  const asar = path.resolve(process.argv[2]);
  const folders = await readdir('tmp/ocr-tests');
  const fixtureImage = path.resolve('tmp/ocr-tests', folders.at(-1), '000001.png');
  const target = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(asar, 'electron/download-worker.js'), {
      execArgv: ['--import', pathToFileURL(path.resolve('test/worker-fixture.mjs')).href],
      workerData: { provider: 'mydbook', token: 'fake-test-token', book: { id: 'OCR_PACKAGE_TEST', title: 'Prova OCR' }, tmpDir: path.resolve('tmp/packaged-ocr/cache'), outputDir: path.resolve('tmp/packaged-ocr/output'), fixtureImage, ocr: true, limit: 1 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Timeout worker OCR')); }, 30000);
    worker.on('message', event => {
      if (event.type === 'done') { clearTimeout(timer); resolve(event.target); }
      if (event.type === 'failed') { clearTimeout(timer); reject(new Error(event.message)); }
      // The fixture is already a valid PNG; Chromium conversion is exercised by
      // the separate desktop test. This check targets OCR and packaged models.
      if (event.type === 'convert') { worker.postMessage({ type: 'converted', id: event.id, result: event.payload.base64 }); }
    });
    worker.on('error', error => { clearTimeout(timer); reject(error); });
  });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(await readFile(target)) }).promise;
  try {
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ').replace(/\s+/g, ' ');
    assert.match(text, /Ciao mondo/); assert.match(text, /Hello world/);
    assert.match(target, /-ocr\.pdf$/);
  } finally { await pdf.destroy(); }
  console.log('OCR confezionato verificato: modelli locali, worker da app.asar e testo italiano/inglese ricercabile.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
