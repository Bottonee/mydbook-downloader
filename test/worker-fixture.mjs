// Risposte sintetiche solo per test offline; non vengono incluse nell'app.
import { workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
const image = workerData?.fixtureImage ? await readFile(workerData.fixtureImage) : null;
if (image) globalThis.fetch = async (url, options) => {
  options.signal?.throwIfAborted();
  const pathname = new URL(url).pathname;
  if (pathname === '/fixture-page.png') return new Response(image, { headers: { 'content-type': 'image/png' } });
  if (pathname.includes('/details/')) {
    const id = decodeURIComponent(pathname.split('/').at(-1));
    return new Response(JSON.stringify({ pages: [{ id, url: 'https://mydbook.olhos.it/fixture-page.png' }] }));
  }
  return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: {
    user: { token: 'fake-test-token', bookcodes: [workerData.book.id] },
    infoFixedPage: { title: 'Libro di prova offline' }, listPages: [{ id: 'copertina' }, { id: '2' }, { id: '9' }],
  } } }) + '</script>');
};
