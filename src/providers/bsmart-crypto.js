// Reader format adapted from Leone25/bSmart-downloader (MIT).
// Copyright (c) 2021 Enrico. See licenses/bsmart-downloader-MIT.txt.
import { createDecipheriv } from 'node:crypto';
import msgpack from 'msgpack-lite';
import { ApiError } from '../api.js';
import { bsmartConfig } from './bsmart.config.js';

export function extractReaderKey(script) {
  const pattern = /var\s+([A-Za-z_$][\w$]*)=String\.fromCharCode\(([^)]*)\),([A-Za-z_$][\w$]*)=["']constructor["'];\3\[\3\]\[\3\]\((.*?)\)\(\)/gs;
  for (const match of script.matchAll(pattern)) {
    const [, variable, codes, , expression] = match;
    const numbers = codes.split(',').map(value => Number(value.trim()));
    if (numbers.some(value => !Number.isInteger(value) || value < 0 || value > 65535)) continue;
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const indexes = [...expression.matchAll(new RegExp(`${escaped}\\[(\\d+)\\]`, 'g'))].map(item => Number(item[1]));
    if (!indexes.length || indexes.some(index => index >= numbers.length)) continue;
    // Reconstruct literals only: never execute remote JavaScript.
    const literal = indexes.map(index => String.fromCharCode(numbers[index])).join('');
    for (const candidate of literal.matchAll(/['"]([A-Za-z0-9+/]{22,44}={0,2})['"]/g)) {
      const key = Buffer.from(candidate[1], 'base64');
      if ([16, 24, 32].includes(key.length) && key.toString('base64') === candidate[1]) return key;
    }
  }
  return null;
}

let cachedKey;
let pending;
export async function fetchReaderKey(api) {
  if (cachedKey) return cachedKey;
  if (!pending) pending = (async () => {
    const readerUrl = bsmartConfig.encryption.readerUrl;
    const html = await api.request(readerUrl, { authenticate: false });
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)]
      .map(match => new URL(match[1], readerUrl)).filter(url => url.origin === new URL(readerUrl).origin);
    for (const url of scripts) {
      const script = await api.request(url.href, { authenticate: false });
      const key = extractReaderKey(script);
      if (key) { cachedKey = key; return key; }
    }
    throw new ApiError('Formato del lettore bSmart cambiato: impossibile recuperare la chiave. Aggiorna l’app o segnala il problema.');
  })().finally(() => { pending = undefined; });
  return pending;
}

export function decryptResource(file, key, config = bsmartConfig.encryption) {
  try {
    if (![16, 24, 32].includes(key.length) || file.length < config.headerSize + config.ivSize + 16) throw new Error();
    const header = msgpack.decode(file.subarray(0, config.headerSize));
    const start = header?.[config.startField];
    if (!Number.isInteger(start) || start > file.length || start < config.headerSize + config.ivSize + 16) throw new Error();
    const encrypted = file.subarray(config.headerSize + config.ivSize, start);
    if (encrypted.length % 16) throw new Error();
    const iv = file.subarray(config.headerSize, config.headerSize + config.ivSize);
    const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
    decipher.setAutoPadding(false);
    let prefix = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const padding = prefix.at(-1);
    if (padding >= 1 && padding <= 16 && prefix.subarray(-padding).every(value => value === padding)) prefix = prefix.subarray(0, -padding);
    return Buffer.concat([prefix, file.subarray(start)]);
  } catch { throw new ApiError('Pagina bSmart cifrata non valida o formato non supportato.'); }
}
