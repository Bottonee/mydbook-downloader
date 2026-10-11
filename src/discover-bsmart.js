import { chromium } from 'playwright';
import prompts from 'prompts';
import { mkdir, writeFile } from 'node:fs/promises';
import { bsmartConfig } from './providers/bsmart.config.js';

function schema(value, depth = 0) {
  if (value === null) return 'null';
  if (depth > 5) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) return { length: value.length, item: value.length ? schema(value[0], depth + 1) : 'unknown' };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [/^[A-Za-z_][A-Za-z_\d]{0,45}$/.test(key) ? key : '[chiave omessa]', schema(item, depth + 1)]));
  return typeof value;
}
export async function discoverBsmart({ headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext(); // No persistent Chromium profile, HAR or credentials on disk.
  const page = await context.newPage(), traffic = [], pending = [];
  context.on('response', response => {
    const request = response.request(), url = new URL(response.url());
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    if (!url.hostname.endsWith('.bsmart.it')) return;
    pending.push((async () => {
      const headers = await request.allHeaders();
      const record = { method: request.method(), origin: url.origin, path: url.pathname.startsWith('/api/') ? url.pathname.replace(/eyJ[A-Za-z\d_.%-]+/g, '[omesso]') : '[risorsa omessa]', queryKeys: [...url.searchParams.keys()], status: response.status(), requestHeaderNames: Object.keys(headers), contentType: response.headers()['content-type'] || '' };
      if (record.contentType.includes('json')) record.responseSchema = schema(await response.json().catch(() => null));
      traffic.push(record);
    })());
  });
  try {
    await page.goto(bsmartConfig.loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    if (headed) {
      console.log('Accedi manualmente nel browser, apri la libreria e sfoglia tre pagine di un libro. Non incollare credenziali nel terminale.');
      await prompts({ type: 'confirm', name: 'done', message: 'Hai completato accesso e navigazione? Termina la raccolta', initial: true });
    }
    await Promise.allSettled(pending);
    const cookies = await context.cookies();
    const storageKeyNames = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })).catch(() => null);
    await mkdir('docs', { recursive: true });
    await writeFile('docs/bsmart-discovery.json', JSON.stringify({ date: new Date().toISOString(), officialLoginOrigin: new URL(page.url()).origin, cookieNames: [...new Set(cookies.map(c => c.name))], storageKeyNames, traffic }, null, 2));
    console.log('Riepilogo strutturale senza valori salvato in docs/bsmart-discovery.json. La raccolta non abilita automaticamente il download: verifica cifratura e mapping delle pagine.');
  } finally { await browser.close(); }
}
