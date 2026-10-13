import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { zanichelliConfig } from './providers/zanichelli.config.js';

const headed = process.argv.includes('--headed');
const report = { provider: 'zanichelli', date: new Date().toISOString(), loginUrl: zanichelliConfig.loginUrl, cookieNames: [], scripts: [], traffic: [] };
const pending = new Set();
const safePath = pathname => pathname.replace(/eyJ[A-Za-z0-9_.%-]+/g, '[token]').replace(/[^/]*@[^/]+/g, '[email]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]').replace(/\b\d{5,}\b/g, '[id]');
const official = address => { try { return new URL(address).hostname.endsWith('.zanichelli.it'); } catch { return false; } };
const schema = (value, depth = 0) => {
  if (depth > 4) return '...';
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', length: value.length, item: value.length ? schema(value[0], depth + 1) : null };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [/^[A-Za-z_][A-Za-z_\d]{0,45}$/.test(key) ? key : '[chiave omessa]', schema(item, depth + 1)]));
  return typeof value;
};
const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ acceptDownloads: false });
const observe = page => {
  page.on('response', response => {
    const request = response.request(), url = new URL(response.url());
    if (!official(url.href)) return;
    if (request.resourceType() === 'script') {
      const source = { origin: url.origin, path: safePath(url.pathname) };
      if (!report.scripts.some(item => item.origin === source.origin && item.path === source.path)) report.scripts.push(source);
    }
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    const entry = { method: request.method(), origin: url.origin, path: safePath(url.pathname), queryKeys: [...url.searchParams.keys()], status: response.status(), requestHeaderNames: Object.keys(request.headers()), contentType: response.headers()['content-type'] || '' };
    report.traffic.push(entry);
    if (entry.contentType.includes('json')) {
      const work = response.json().then(value => { entry.responseSchema = schema(value); }).catch(() => {});
      pending.add(work); void work.finally(() => pending.delete(work));
    }
  });
};
context.on('page', page => {
  observe(page);
  // Playwright can keep Chromium alive after its last tab is closed.
  // Finish the capture when the user closes the final discovery window.
  page.once('close', () => { if (headed && !context.pages().length) void browser.close().catch(() => {}); });
});
try {
  const page = await context.newPage();
  await page.goto(zanichelliConfig.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (headed) {
    console.log('Accedi manualmente sul sito ufficiale, apri la libreria e un ebook, sfoglia almeno tre pagine. Non condividere password. Chiudi il browser per terminare la discovery.');
    const interval = setInterval(() => { void context.cookies().then(cookies => { report.cookieNames = [...new Set(cookies.filter(cookie => cookie.domain.endsWith('zanichelli.it')).map(cookie => cookie.name))]; }).catch(() => {}); }, 1500);
    try { await new Promise(resolve => browser.once('disconnected', resolve)); } finally { clearInterval(interval); }
  } else {
    await page.waitForTimeout(5000);
    report.cookieNames = [...new Set((await context.cookies()).filter(cookie => cookie.domain.endsWith('zanichelli.it')).map(cookie => cookie.name))];
  }
} finally {
  await Promise.allSettled([...pending]);
  await browser.close().catch(() => {});
  await mkdir('docs', { recursive: true });
  await writeFile('docs/zanichelli-discovery.json', JSON.stringify(report, null, 2));
}
console.log('Report salvato in docs/zanichelli-discovery.json: soli schemi e nomi, senza credenziali, corpi di login o firme URL.');
