import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ApiError, loadToken } from './api.js';
import { config } from './config.js';
import { discoverBsmart } from './discover-bsmart.js';

function schema(value, depth = 0) {
  if (value === null) return 'null';
  if (depth > 6) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) return { length: value.length, item: value.length ? schema(value[0], depth + 1) : 'unknown' };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, schema(item, depth + 1)]));
  return typeof value;
}
function safeUrl(value, token) {
  const url = new URL(value);
  const pathname = url.pathname.replaceAll(token, '[omesso]').replace(/eyJ[A-Za-z0-9_.%-]+/g, '[omesso]');
  return url.origin + pathname + (url.search ? '?' + [...url.searchParams.keys()].map(k => `${k}=[omesso]`).join('&') : '');
}
let browser;
try {
  const { values } = parseArgs({ options: { provider: { type: 'string', default: 'mydbook' }, book: { type: 'string' }, headed: { type: 'boolean' } } });
  if (values.provider === 'zanichelli') { await import('./discover-zanichelli.js'); process.exit(0); }
  if (values.provider === 'bsmart') {
    await discoverBsmart(values);
  } else {
  if (values.provider !== 'mydbook') throw new ApiError('Provider non valido.');
  const token = loadToken();
  browser = await chromium.launch({ headless: !values.headed });
  const context = await browser.newContext();
  await context.addCookies([{ name: config.auth.cookieName, value: token, domain: new URL(config.baseUrl).hostname, path: config.auth.cookiePath, secure: true, httpOnly: false }]);
  const page = await context.newPage();
  const traffic = [], pending = [];
  page.on('response', response => {
    const request = response.request();
    if (!['xhr', 'fetch', 'image', 'document'].includes(request.resourceType())) return;
    if (new URL(response.url()).origin !== config.baseUrl) return;
    pending.push((async () => {
      const headers = await request.allHeaders();
      const record = {
        method: request.method(), url: safeUrl(response.url(), token), status: response.status(), resourceType: request.resourceType(),
        requestHeaderNames: Object.keys(headers).sort(),
        hasBearerAuthorization: headers.authorization?.startsWith('Bearer ') || false,
        hasUserTokenCookie: (headers.cookie || '').includes(`${config.auth.cookieName}=`),
        contentType: response.headers()['content-type'] || '',
      };
      // Solo struttura: mai salvare risposte grezze, cookie, firme o dati personali.
      if (record.contentType.includes('json')) record.responseSchema = schema(await response.json().catch(() => null));
      traffic.push(record);
    })());
  });
  await page.goto(config.baseUrl + '/mydbook', { waitUntil: 'domcontentloaded' });
  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.src).filter(src => new URL(src).origin === location.origin));
  let cookieCodeConfirmed = false, bearerCodeConfirmed = false;
  for (const src of scripts) {
    const response = await context.request.get(src);
    const source = await response.text();
    if (source.includes('document.cookie') && source.includes('userToken')) cookieCodeConfirmed = true;
    if (source.includes('userToken') && /Authorization.{0,30}Bearer/.test(source)) bearerCodeConfirmed = true;
  }
  if (!cookieCodeConfirmed || !bearerCodeConfirmed) throw new ApiError('Meccanismo di autenticazione non confermato nel JavaScript attuale. Serve un HAR del browser autenticato.');
  await page.goto(config.baseUrl + config.libraryPath, { waitUntil: 'domcontentloaded' });
  const readProps = async () => {
    const content = await page.locator('#__NEXT_DATA__').textContent();
    const data = JSON.parse(content).props.pageProps;
    if (!data.user?.token) throw new ApiError('Autenticazione non riuscita. Serve un token valido oppure un HAR del browser autenticato.', 401);
    return data;
  };
  const library = await readProps();
  const volumes = library.blocks?.find(b => b.blockConfiguration?.i18n?.key === config.libraryBlockKey)?.blockConfiguration?.volumes;
  if (!Array.isArray(volumes)) throw new ApiError('Elenco libri non riconosciuto. Serve un HAR della libreria.');
  const allowed = volumes.filter(b => library.user.bookcodes?.includes(b.bookcode));
  const candidates = values.book ? allowed.filter(b => b.bookcode === values.book) : [...allowed].sort((a, b) => Number(/volume/i.test(b.title)) - Number(/volume/i.test(a.title)));
  if (!candidates.length) throw new ApiError('Libro non trovato nella libreria.');
  let reader, chosen;
  for (const book of candidates) {
    await page.goto(config.baseUrl + config.bookPath(book.bookcode), { waitUntil: 'domcontentloaded' });
    const props = await readProps();
    if (props.listPages?.length && props.infoFixedPage?.pages?.length) { reader = props; chosen = book; break; }
  }
  if (!reader) throw new ApiError('Nessun lettore a impaginazione fissa accessibile. Serve un HAR dell’apertura di un libro.');
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    const next = page.getByRole('button', { name: 'Pagina successiva', exact: true });
    if (await next.isEnabled()) await next.click();
    else await page.getByRole('button', { name: 'Pagina precedente', exact: true }).click();
    await page.waitForTimeout(1000);
  }
  await Promise.allSettled(pending);
  const details = traffic.filter(r => r.url.includes('/data/v1/fixedlayout/') && r.status === 200);
  const images = traffic.filter(r => r.resourceType === 'image' && r.url.includes('/contents-private/') && r.status === 200);
  if (!details.length || !images.length) throw new ApiError('Traffico delle pagine non confermato. Serve un HAR sfogliando alcune pagine del libro.');
  await mkdir('docs', { recursive: true });
  await writeFile('docs/discovery.json', JSON.stringify({
    date: new Date().toISOString(), authentication: { cookieName: config.auth.cookieName, cookiePath: config.auth.cookiePath, headerName: config.auth.headerName, scheme: config.auth.scheme, cookieCodeConfirmed, bearerCodeConfirmed },
    library: { url: config.baseUrl + config.libraryPath, bookCount: allowed.length, schema: schema(library.blocks) },
    reader: { bookId: chosen.bookcode, totalPages: reader.listPages.length, listPagesSchema: schema(reader.listPages), infoFixedPageSchema: schema(reader.infoFixedPage) }, traffic,
  }, null, 2));
  console.log(`Discovery completata: ${allowed.length} libri, ${reader.listPages.length} pagine nel libro verificato. Report senza credenziali: docs/discovery.json; riepilogo: docs/endpoints.md.`);
  }
} catch (error) {
  console.error(error instanceof ApiError ? error.message : 'Discovery non completata: verifica Chromium, rete e token. Se il sito non è accessibile, serve un HAR esportato dalla libreria e dal lettore autenticati.');
  process.exitCode = 1;
} finally { await browser?.close(); }
