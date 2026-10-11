import prompts from 'prompts';
import { parseArgs } from 'node:util';
import { ApiError, loadToken } from './api.js';
import { getProvider } from './providers/index.js';
import { loadSavedSession } from './saved-session.js';
import { downloadBook } from './download.js';
import { closeImages, validateJpegQuality } from './images.js';
import { userError } from '../electron/errors.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
let token = '';
try {
  const { values } = parseArgs({ options: { provider: { type: 'string', default: 'mydbook' }, book: { type: 'string' }, list: { type: 'boolean' }, sample: { type: 'string' }, compress: { type: 'boolean' }, quality: { type: 'string' } } });
  const provider = getProvider(values.provider);
  const compress = Boolean(values.compress || values.quality !== undefined);
  const quality = validateJpegQuality(values.quality === undefined ? 80 : Number(values.quality));
  try { token = await loadSavedSession(provider.id) || ''; } catch { /* Environment-token mode also works without Electron. */ }
  if (!token) token = loadToken(provider.id);
  const books = await provider.listBooks(token, { signal: controller.signal });
  if (!books.length) throw new ApiError('Nessun libro disponibile nella tua libreria.');
  books.forEach((b, i) => console.log(`${i + 1}. ${b.title} [${b.id}]${b.subtitle ? ` — ${b.subtitle}` : ''}`));
  if (!values.list) {
    let id = values.book;
    if (!id) { const answer = await prompts({ type: 'select', name: 'id', message: 'Scegli il libro da scaricare', choices: books.map((b, i) => ({ title: `${i + 1}. ${b.title}`, value: b.id })) }); id = answer.id; }
    if (id) {
      const book = books.find(b => b.id === id);
      if (!book) throw new ApiError('Libro non trovato nella tua libreria.');
      const limit = values.sample === undefined ? undefined : Number(values.sample);
      const target = await downloadBook({ provider: provider.id, token, book, signal: controller.signal, compress, quality, limit });
      console.log(`PDF salvato: ${target}`);
    } else console.log('Operazione annullata.');
  }
} catch (error) {
  console.error(controller.signal.aborted ? 'Download interrotto. Riavvia lo script per riprendere.' : userError(error, token));
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally { token = ''; await closeImages(); }
