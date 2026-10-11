import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
function icon(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, pos = y * (size * 4 + 1) + 1 + x * 4;
    const cornerX = Math.max(.15 - u, u - .85, 0), cornerY = Math.max(.15 - v, v - .85, 0);
    const visible = cornerX * cornerX + cornerY * cornerY < .15 * .15;
    let color = [36, 107, 94];
    const left = u > .22 && u < .485 && v > .25 + (u - .22) * .12 && v < .72 + (u - .22) * .12;
    const right = u > .515 && u < .78 && v > .282 - (u - .515) * .12 && v < .752 - (u - .515) * .12;
    if (left || right) color = [247, 245, 225];
    if ((left || right) && ((v > .39 && v < .405) || (v > .47 && v < .485) || (v > .55 && v < .565)) && u > .27 && u < .73) color = [163, 189, 165];
    rows[pos] = color[0]; rows[pos + 1] = color[1]; rows[pos + 2] = color[2]; rows[pos + 3] = visible ? 255 : 0;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('build', { recursive: true });
await writeFile('build/icon.png', icon(1024));
const png = icon(256), header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await writeFile('build/icon.ico', Buffer.concat([header, png]));
