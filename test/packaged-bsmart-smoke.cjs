// Run with the packaged Electron executable in Node mode: no UI or user profile is opened.
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFile } = require('node:fs/promises');
const { PDFDocument } = require('pdf-lib');
(async () => {
  const asar = path.resolve(process.argv[2]);
  const target = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(asar, 'electron/download-worker.js'), {
      execArgv: ['--import', pathToFileURL(path.resolve('test/bsmart-worker-fixture.mjs')).href],
      workerData: { provider: 'bsmart', token: 'bsmart-fixture', book: { id: '42', title: 'Libro bSmart offline' }, tmpDir: path.resolve('tmp/packaged-bsmart/cache'), outputDir: path.resolve('tmp/packaged-bsmart/output') },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Timeout worker confezionato')); }, 30000);
    worker.on('message', event => {
      if (event.type === 'done') { clearTimeout(timer); resolve(event.target); }
      if (event.type === 'failed') { clearTimeout(timer); reject(new Error(event.message)); }
    });
    worker.on('error', error => { clearTimeout(timer); reject(error); });
    worker.on('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Worker interrotto')); });
  });
  const pdf = await PDFDocument.load(await readFile(target));
  assert.equal(pdf.getPageCount(), 3);
  assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [300, 301, 302]);
  console.log('Worker bSmart confezionato verificato: pagine cifrate sintetiche, MessagePack e PDF nativi da app.asar.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
