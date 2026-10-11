import { ApiError } from '../api.js';
import { mydbook } from './mydbook.js';
import { bsmart } from './bsmart.js';
export const providers = Object.freeze({ mydbook, bsmart });
export function getProvider(id = 'mydbook') {
  const provider = Object.hasOwn(providers, id) && providers[id];
  if (!provider) throw new ApiError('Provider non valido. Scegli mydbook oppure bsmart.');
  return provider;
}
export const providerList = Object.values(providers).map(({ id, name, loginUrl, config }) => ({ id, name, loginUrl, downloadSupported: config.downloadSupported !== false, compressionSupported: config.pageType !== 'pdf', limitation: config.limitation || '' }));
