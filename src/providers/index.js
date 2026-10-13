import { ApiError } from '../api.js';
import { mydbook } from './mydbook.js';
import { bsmart } from './bsmart.js';
import { zanichelli } from './zanichelli.js';
export const providers = Object.freeze({ mydbook, bsmart, zanichelli });
export function getProvider(id = 'mydbook') {
  const provider = Object.hasOwn(providers, id) && providers[id];
  if (!provider) throw new ApiError(`Provider non valido. Scegli ${Object.keys(providers).join(', ')}.`);
  return provider;
}
export const providerList = Object.values(providers).map(({ id, name, loginUrl, config }) => ({ id, name, loginUrl, downloadSupported: config.downloadSupported !== false, compressionSupported: config.compressionSupported ?? config.pageType !== 'pdf', limitation: config.limitation || '' }));
