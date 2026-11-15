import { mydbookConfig } from './mydbook.config.js';
import { createOlhosProvider } from './mydbook.js';
const origin = 'https://flowbooks.olhos.it';
function tenantConfig(id, tenant, name) {
  return Object.freeze({
    ...mydbookConfig, id, name, tenant, baseUrl: origin, referer: `${origin}/${tenant}/`,
    loginUrl: `${origin}/${tenant}/login`, browserLogin: true,
    libraryPath: `/${tenant}/dashboard`,
    bookPath: id => `/${tenant}/${encodeURIComponent(id)}/1/fixed`,
    pageDetailsPath: (id, page) => `/data/v1/fixedlayout/${tenant}/${encodeURIComponent(id)}/details/${encodeURIComponent(page)}/${encodeURIComponent(page)}`,
    extraction: { ...mydbookConfig.extraction, origins: [origin] },
    coverOrigins: [origin], ocrSupported: true, compressionSupported: true,
    readerUrl: id => `${origin}/${tenant}/${encodeURIComponent(id)}/1/fixed`,
  });
}
export const flowbooks = createOlhosProvider(tenantConfig('flowbooks', 'edisco', 'FlowBooks — Edisco'));
export const flowbooksDigistore = createOlhosProvider(tenantConfig('flowbooks-digistore', 'digistore', 'FlowBooks — DigiStore'));
