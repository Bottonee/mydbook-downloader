import prompts from 'prompts';
import { parseArgs } from 'node:util';
import { Api, ApiError, loadToken } from './api.js';
import { listBooks, bookMetadata, downloadPages } from './books.js';
import { mergePdf } from './pdf.js';
import { closeImages, validateJpegQuality } from './images.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
try {
  const { values } = parseArgs({ options: { book: { type: 'string' }, list: { type: 'boolean' }, sample: { type: 'string' }, compress: { type: 'boolean' }, quality: { type: 'string' } } });
  const compress = Boolean(values.compress || values.quality !== undefined);
  const quality = validateJpegQuality(values.quality === undefined ? 80 : Number(values.quality));
  const api = new Api(loadToken(), controller.signal);
  const books = await listBooks(api);
  if (!books.length) throw new ApiError('Nessun libro disponibile nella tua libreria.');
  books.forEach((b, i) => console.log(`${i + 1}. ${b.title} [${b.id}]${b.subtitle ? ` — ${b.subtitle}` : ''}`));
  if (!values.list) {
    let id = values.book;
    if (!id) {
      const answer = await prompts({ type: 'select', name: 'id', message: 'Scegli il libro da scaricare', choices: books.map((b, i) => ({ title: `${i + 1}. ${b.title}`, value: b.id })) });
      id = answer.id;
    }
    if (id) {
      const selected = books.find(b => b.id === id);
      if (!selected) throw new ApiError('Libro non trovato nella tua libreria.');
      const full = await bookMetadata(api, selected);
      let count = full.pages.length;
      if (values.sample) {
        count = Number(values.sample);
        if (!Number.isInteger(count) || count < 1 || count > full.pages.length) throw new ApiError('Il numero di pagine del campione deve essere un intero tra 1 e il totale.');
      }
      console.log(`${full.title}: ${full.pages.length} pagine${values.sample ? ` (campione di ${count})` : ''}.`);
      // Il manifest deve restare completo anche durante una prova parziale.
      const downloadBook = { ...full, pages: full.pages.slice(0, count) };
      const files = await downloadPages(api, full, { limit: count });
      const target = await mergePdf(downloadBook, files, { sample: Boolean(values.sample), signal: controller.signal, compress, quality });
      console.log(`PDF salvato: ${target}`);
    } else console.log('Operazione annullata.');
  }
} catch (error) {
  console.error(controller.signal.aborted ? 'Download interrotto. Riavvia lo script per riprendere.' : error instanceof ApiError ? error.message : 'Errore imprevisto. Controlla rete, spazio su disco e permessi delle cartelle.');
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally { await closeImages(); }
