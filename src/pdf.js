import { PDFDocument } from 'pdf-lib';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { ApiError } from './api.js';

export function sanitizeTitle(title) {
  let name = String(title).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 150).replace(/[. ]+$/g, '');
  if (!name) name = 'libro';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
export async function mergePdf(book, files, { sample = false, signal } = {}) {
  if (files.length !== book.pages.length) throw new ApiError('Pagine mancanti: PDF non creato.');
  const pdf = await PDFDocument.create();
  pdf.setTitle(book.title); pdf.setCreator('mydbook-downloader');
  for (let i = 0; i < files.length; i++) {
    signal?.throwIfAborted();
    let image;
    try { image = await pdf.embedPng(await readFile(files[i])); } catch { throw new ApiError(`Pagina mancante o danneggiata: ${book.pages[i].id}.`); }
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  await mkdir(config.outputDir, { recursive: true });
  const suffix = sample ? `-campione-${files.length}` : '';
  const target = path.join(config.outputDir, `${sanitizeTitle(book.title)}${suffix}.pdf`);
  const bytes = await pdf.save();
  signal?.throwIfAborted();
  await writeFile(target + '.part', bytes); await rename(target + '.part', target);
  return path.resolve(target);
}
