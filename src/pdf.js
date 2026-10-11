import { PDFDocument } from 'pdf-lib';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { ApiError } from './api.js';
import { imageToJpeg, validateJpegQuality } from './images.js';
import cliProgress from 'cli-progress';

export function sanitizeTitle(title) {
  let name = String(title).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 150).replace(/[. ]+$/g, '');
  if (!name) name = 'libro';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
export async function mergePdf(book, files, { sample = false, signal, compress = false, quality = 80, quiet = false, outputDir = config.outputDir, onProgress = () => {} } = {}) {
  if (files.length !== book.pages.length) throw new ApiError('Pagine mancanti: PDF non creato.');
  // Native PDF pages retain text/vectors; JPEG compression applies only to raster pages.
  compress = compress && files.some(file => path.extname(file) !== '.pdf');
  if (compress) validateJpegQuality(quality);
  const pdf = await PDFDocument.create();
  pdf.setTitle(book.title); pdf.setCreator('mydbook-downloader');
  const bar = new cliProgress.SingleBar({ format: `${compress ? 'Compressione e PDF' : 'Creazione PDF'} {bar} {value}/{total}`, hideCursor: true }, cliProgress.Presets.shades_classic);
  if (!quiet) bar.start(files.length, 0);
  onProgress({ phase: 'pdf', completed: 0, total: files.length });
  try {
    for (let i = 0; i < files.length; i++) {
      signal?.throwIfAborted();
      try {
        const bytes = await readFile(files[i]);
        if (path.extname(files[i]) === '.pdf') {
          const source = await PDFDocument.load(bytes);
          if (source.getPageCount() !== 1) throw new Error();
          const [page] = await pdf.copyPages(source, [0]);
          pdf.addPage(page);
        } else {
          const image = compress ? await pdf.embedJpg(await imageToJpeg(bytes, quality)) : await pdf.embedPng(bytes);
          const page = pdf.addPage([image.width, image.height]);
          page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        }
      } catch { throw new ApiError(`Pagina ${i + 1}: risorsa mancante, danneggiata o conversione fallita.`); }
      if (!quiet) bar.update(i + 1);
      onProgress({ phase: 'pdf', completed: i + 1, total: files.length });
    }
  } finally { if (!quiet) bar.stop(); }
  await mkdir(outputDir, { recursive: true });
  const suffix = (sample ? `-campione-${files.length}` : '') + (compress ? `-compresso-q${quality}` : '');
  const target = path.join(outputDir, `${sanitizeTitle(book.title)}${suffix}.pdf`);
  if (!quiet) console.log('Salvataggio PDF...');
  onProgress({ phase: 'saving', completed: 0, total: files.length });
  const bytes = await pdf.save();
  signal?.throwIfAborted();
  await writeFile(target + '.part', bytes); await rename(target + '.part', target);
  onProgress({ phase: 'complete', completed: files.length, total: files.length });
  return path.resolve(target);
}
