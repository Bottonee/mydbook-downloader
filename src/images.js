import { decodeImage } from './image-codec.js';
import { ApiError } from './api.js';

let renderer, adapter;
export function setImageConverter(converter) { adapter = converter; }
async function getRenderer() {
  renderer ??= (async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      return { browser, page };
    } catch (error) { await browser.close(); throw error; }
  })();
  return renderer;
}
export function validateJpegQuality(quality) {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new ApiError('La qualità JPEG deve essere un intero tra 1 e 100.');
  return quality;
}
async function convertImage(bytes, { format = 'png', quality = 80 } = {}) {
  if (!bytes?.length) throw new ApiError('Immagine vuota.');
  const payload = { base64: bytes.toString('base64'), format, quality };
  const result = adapter ? await adapter(payload) : await (await getRenderer()).page.evaluate(decodeImage, payload);
  return Buffer.from(result, 'base64');
}
export const imageToPng = bytes => convertImage(bytes);
export const imageToJpeg = (bytes, quality = 80) => convertImage(bytes, { format: 'jpeg', quality: validateJpegQuality(quality) });
export async function closeImages() {
  if (renderer) { await renderer.then(r => r.browser.close()).catch(() => {}); renderer = undefined; }
}
