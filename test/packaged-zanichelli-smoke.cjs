const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
(async () => {
  const requireApp = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'));
  const { getProvider } = requireApp('./src/providers/index.js');
  const provider = getProvider('zanichelli');
  globalThis.fetch = async (url, { headers }) => {
    assert.equal(new URL(url).pathname, '/v3/dashboard/licenses/real');
    assert.equal(headers['myz-token'], 'zanichelli-fixture');
    return new Response(JSON.stringify({ realLicenses: [{ volume: { isbn: '9780000000001', title: 'Libro Zanichelli offline', ereader_url: 'https://webreader.zanichelli.it/reader', ereader_info: { id: 10 } } }] }));
  };
  const books = await provider.listBooks('zanichelli-fixture');
  assert.equal(books.length, 1); assert.equal(books[0].provider, 'zanichelli');
  assert.equal(provider.config.downloadSupported, true);
  await assert.rejects(provider.getPages('zanichelli-fixture', books[0].id), /solo myz-token/);
  const { pagePdf } = requireApp('./src/providers/zanichelli-pdf.js');
  const { PDFDocument } = requireApp('pdf-lib');
  const bytes = await pagePdf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 500"><rect width="300" height="500" fill="white"/></svg>'), 'image/svg+xml');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  console.log('Provider Zanichelli confezionato verificato: registro, libreria e conversione SVG/PDF.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
