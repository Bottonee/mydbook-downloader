const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
(async () => {
  const requireApp = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'));
  const { getProvider, providerList } = requireApp('./src/providers/index.js');
  for (const [id, tenant] of [['flowbooks', 'edisco'], ['flowbooks-digistore', 'digistore']]) {
    const provider = getProvider(id);
    globalThis.fetch = async (url, { headers }) => {
      assert.equal(new URL(url).origin, 'https://flowbooks.olhos.it');
      assert.equal(new URL(url).pathname, `/${tenant}/dashboard`);
      assert.equal(headers.Authorization, 'Bearer fixture');
      return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { user: { token: 'fixture', bookcodes: ['BOOK'] }, blocks: [{ blockConfiguration: { i18n: { key: 'user_my_books_block' }, volumes: [{ bookcode: 'BOOK', title: 'Libro FlowBooks' }] } }] } } }) + '</script>');
    };
    assert.equal((await provider.listBooks('fixture'))[0].provider, id);
    assert.equal(providerList.find(provider => provider.id === id).openSupported, true);
  }
  console.log('Pacchetto FlowBooks verificato: entrambi i tenant, libreria e lettore.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
