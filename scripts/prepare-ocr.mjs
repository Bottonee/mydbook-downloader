import { createRequire } from 'node:module';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const destination = fileURLToPath(new URL('../build/ocr', import.meta.url));
await mkdir(destination, { recursive: true });
for (const code of ['ita', 'eng']) {
  const folder = path.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`));
  await copyFile(path.join(folder, '4.0.0_best_int', `${code}.traineddata.gz`), path.join(destination, `${code}.traineddata.gz`));
}
console.log('Modelli OCR italiano/inglese preparati per l’uso offline.');
