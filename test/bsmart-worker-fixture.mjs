import { encryptedResource, pagePdf, readerBundle } from './bsmart-fixtures.mjs';
const pages = await Promise.all([pagePdf(0), pagePdf(1), pagePdf(2)]);
globalThis.fetch = async (url, { headers }) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'my.bsmart.it') return new Response(parsed.pathname === '/' ? '<script src="/scripts/fixture.js"></script>' : readerBundle());
  if (parsed.hostname === 'cdn.example') {
    if (headers.AUTH_TOKEN || headers.Cookie) throw new Error('Credenziali inviate al CDN');
    return new Response(encryptedResource(pages[Number(parsed.pathname.slice(1))]));
  }
  if (parsed.pathname.includes('/by_book_id/')) return new Response(JSON.stringify({ id: 42, title: 'Libro bSmart offline', current_edition: { revision: 7 } }));
  return new Response(JSON.stringify([{ assets: pages.map((_, i) => ({ id: i + 1, use: 'page_pdf', url: `https://cdn.example/${i}`, encrypted: true })) }]));
};
