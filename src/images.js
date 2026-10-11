import { chromium } from 'playwright';
import { ApiError } from './api.js';

let renderer;
async function getRenderer() {
  renderer ??= (async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      return { browser, page };
    } catch (error) { await browser.close(); throw error; }
  })();
  return renderer;
}
export async function imageToPng(bytes) {
  if (!bytes?.length) throw new ApiError('Immagine vuota.');
  const { page } = await getRenderer();
  const result = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    // Accetta soltanto PNG, JPEG o WebP; non esegue HTML/SVG restituiti per errore.
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!png && !jpeg && !webp) throw new Error('Formato immagine non supportato');
    const blob = new Blob([bytes], { type: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Dimensioni non valide');
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    } finally { URL.revokeObjectURL(url); }
  }, bytes.toString('base64'));
  return Buffer.from(result, 'base64');
}
export async function closeImages() {
  if (renderer) { await renderer.then(r => r.browser.close()).catch(() => {}); renderer = undefined; }
}
