import { createHash } from 'node:crypto';
import { ApiError } from './api.js';

export function printedNumber(label) {
  const match = String(label ?? '').match(/^\s*(?:pag(?:ina|\.)?|p\.)?\s*(\d+)\s*$/i);
  const number = match ? Number(match[1]) : null;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
export function parsePages(expression) {
  if (expression === undefined || expression === null || expression === '') return null;
  if (typeof expression !== 'string' || expression.length > 4000) throw new ApiError('Selezione pagine non valida. Usa numeri e intervalli, per esempio 1, 2, 17-25.');
  if (!expression.trim()) return null;
  const pages = new Set();
  for (const part of expression.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new ApiError('Formato pagine non valido. Esempio: 1, 2, 17-25.');
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > 100000 || end < start || end - start >= 20000) throw new ApiError('Intervallo non valido: usa numeri positivi in ordine crescente, fino a 20.000 pagine.');
    for (let page = start; page <= end; page++) pages.add(page);
    if (pages.size > 20000) throw new ApiError('Sono consentite al massimo 20.000 pagine per selezione.');
  }
  return [...pages].sort((a, b) => a - b);
}
export function selectPages(pages, expression, { firstDigitalPage, firstBookPage = 1 } = {}) {
  const requested = parsePages(expression);
  if (!requested) return { indices: pages.map((_, i) => i), pages, suffix: '' };
  const labels = new Map();
  if (firstDigitalPage !== undefined && firstDigitalPage !== null && firstDigitalPage !== '') {
    if (!Number.isInteger(firstDigitalPage) || firstDigitalPage < 1 || firstDigitalPage > pages.length || !Number.isInteger(firstBookPage) || firstBookPage < 1 || firstBookPage > 100000) throw new ApiError('Calibrazione non valida: indica la posizione digitale della prima pagina numerata e il numero stampato.');
    for (let i = firstDigitalPage - 1; i < pages.length; i++) labels.set(firstBookPage + i - (firstDigitalPage - 1), [i]);
  } else {
    // IDs and filenames are identifiers, never assumed to be printed page numbers.
    for (let i = 0; i < pages.length; i++) {
      const number = printedNumber(pages[i].label);
      if (number !== null) labels.set(number, [...(labels.get(number) || []), i]);
    }
  }
  const missing = requested.filter(number => !labels.has(number));
  if (missing.length) throw new ApiError(`Numerazione del libro non disponibile per le pagine ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. Controlla i numeri o calibra la prima pagina numerata nella sequenza digitale.`);
  if (requested.some(number => labels.get(number).length !== 1)) throw new ApiError('Numerazione ambigua: il libro contiene numeri ripetuti. Calibra la prima pagina numerata per scegliere la sezione corretta.');
  const selected = requested.map(number => ({ index: labels.get(number)[0], number })).sort((a, b) => a.index - b.index);
  const intervals = [];
  for (let i = 0; i < requested.length; i++) {
    const start = requested[i]; let end = start;
    while (requested[i + 1] === end + 1) end = requested[++i];
    intervals.push(start === end ? String(start) : `${start}-${end}`);
  }
  const canonical = intervals.join('_');
  const suffix = canonical.length <= 60 ? canonical : `${canonical.slice(0, 40)}-${createHash('sha256').update(canonical).digest('hex').slice(0, 10)}`;
  return { indices: selected.map(item => item.index), pages: selected.map(item => ({ ...pages[item.index], label: String(item.number) })), suffix: `-pagine-${suffix}` };
}
