import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { ApiError } from '../api.js';

export async function pagePdf(buffer, mediaType, { width, height } = {}) {
  try {
    const svg = mediaType === 'image/svg+xml' ? buffer.toString('utf8') : null;
    if (svg) {
      if (!/<svg\b/i.test(svg) || /<!DOCTYPE|<!ENTITY|<(?:script|foreignObject)\b/i.test(svg)) throw new Error();
      const root = svg.match(/<svg\b[^>]*>/i)[0];
      const view = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
      width ??= Number(root.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1]) || view?.[2];
      height ??= Number(root.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1]) || view?.[3];
    }
    const doc = new PDFDocument({ autoFirstPage: false, compress: true });
    const chunks = [];
    const finished = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    // Attach a handler immediately, including if rendering fails synchronously.
    finished.catch(() => {});
    try {
      if (!svg) { const image = doc.openImage(buffer); width ??= image.width; height ??= image.height; }
      if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 50000)) throw new Error();
      doc.addPage({ size: [width, height], margin: 0 });
      if (svg) SVGtoPDF(doc, svg, 0, 0, { width, height, assumePt: true, warningCallback: warning => { throw new Error(warning); }, imageCallback: src => {
        if (!/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/.test(src)) throw new Error();
        return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
      } });
      else doc.image(buffer, 0, 0, { width, height });
      doc.end();
      return await finished;
    } catch (error) { doc.destroy(); throw error; }
  } catch { throw new ApiError('Conversione pagina Zanichelli fallita: SVG, immagini o font non supportati.'); }
}
