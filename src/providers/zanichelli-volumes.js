import { ApiError } from '../api.js';
import { parseXml } from './zanichelli-reader.js';
import { contentUrl } from './zanichelli-http.js';

// A package ISBN can represent several physical volumes. Split only at boundaries supplied by the TOC.
export function bundleVolumes(title) {
  const match = title.match(/\b(\d+)\s*([A-Z])\s*\+\s*(?:\1\s*)?([A-Z])\b/i);
  return match && match[2].toUpperCase() !== match[3].toUpperCase() ? { text: match[0], number: match[1], letters: [match[2].toUpperCase(), match[3].toUpperCase()] } : null;
}
export function volumeTitle(title, letter) {
  const bundle = bundleVolumes(title);
  return bundle ? title.replace(bundle.text, bundle.number + letter).replace(/\bConfezione\s+/i, '').trim() : `${title} — Volume ${letter}`;
}
export function tocVolumes(document, pages, letters) {
  const positions = new Map(pages.map((page, index) => [page.id, index]));
  const nodes = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$?.href && typeof value.$.feild3 === 'string') nodes.push(value.$);
    for (const [key, child] of Object.entries(value)) if (key !== '$') {
      if (Array.isArray(child)) child.forEach(walk); else walk(child);
    }
  };
  walk(document);
  const anchors = new Map();
  for (const node of nodes) {
    const letter = node.feild3.match(/^Volume\s+([A-Z])$/i)?.[1].toUpperCase();
    if (!letters.includes(letter)) continue;
    const file = node.href.split('#')[0].split('/').at(-1);
    const index = positions.get(file.replace(/\.xhtml$/i, ''));
    if (index === undefined) throw new ApiError('Indice dei volumi Zanichelli non corrispondente alle pagine.');
    const previous = anchors.get(index);
    if (previous && previous !== letter) throw new ApiError('Confine dei volumi Zanichelli ambiguo.');
    anchors.set(index, letter);
  }
  const ordered = [...anchors].sort((a, b) => a[0] - b[0]);
  if (letters.some(letter => !ordered.some(([, current]) => current === letter))) throw new ApiError('Confini dei volumi Zanichelli non presenti nell’indice.');
  const ranges = [];
  for (const [index, letter] of ordered) {
    if (ranges.at(-1)?.letter === letter) continue;
    if (ranges.some(range => range.letter === letter)) throw new ApiError('Pagine dei volumi Zanichelli non consecutive.');
    ranges.push({ letter, start: ranges.length ? index : 0 });
  }
  return ranges.map((range, i) => ({ ...range, end: ranges[i + 1]?.start ?? pages.length }));
}
export async function readerVolumes(metadata, letters) {
  if (metadata.format !== 'pdf' || !metadata.pages[0]?.context) throw new ApiError('Questa confezione Zanichelli non espone volumi PDF separabili.');
  const context = metadata.pages[0].context;
  const toc = await parseXml(await context.http.text(contentUrl('toc.xml', context.base)));
  return tocVolumes(toc, metadata.pages, letters);
}
