import { createCipheriv } from 'node:crypto';
import msgpack from 'msgpack-lite';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const fixtureKey = Buffer.from('0123456789abcdef');
export function readerBundle(key = fixtureKey, variable = '$chars') {
  const literal = `readerKey='${key.toString('base64')}'`;
  const codes = [...literal].map(char => char.charCodeAt(0)).join(',');
  const expression = [...literal].map((_, index) => `${variable}[${index}]`).join('+');
  return `var ${variable}=String.fromCharCode(${codes}),ctor="constructor";ctor[ctor][ctor](${expression})()`;
}
export async function pagePdf(index = 0) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([300 + index, 500 + index]).drawText(`Pagina ${index + 1}`, { font, x: 20, y: 40 });
  return Buffer.from(await document.save());
}
export function encryptedResource(pdf, key = fixtureKey) {
  const iv = Buffer.alloc(16, 7), prefixSize = Math.min(257, pdf.length);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(pdf.subarray(0, prefixSize)), cipher.final()]);
  const header = Buffer.alloc(256);
  msgpack.encode({ start: 256 + iv.length + encrypted.length }).copy(header);
  return Buffer.concat([header, iv, encrypted, pdf.subarray(prefixSize)]);
}
