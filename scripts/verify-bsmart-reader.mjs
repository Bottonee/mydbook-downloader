// Public-site check only. No account, token, key or downloaded book is written to disk.
import { Api } from '../src/api.js';
import { bsmartConfig } from '../src/providers/bsmart.config.js';
import { fetchReaderKey } from '../src/providers/bsmart-crypto.js';
try {
  await fetchReaderKey(new Api('', undefined, bsmartConfig));
  console.log('Lettore pubblico bSmart: recupero della chiave riuscito (valore non mostrato).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
