// Format documented by Leone25/zanichelli-downloader (MIT); see licenses/.
import { createDecipheriv } from 'node:crypto';
import forge from 'node-forge';
import { gunzipSync } from 'node:zlib';
import { ApiError } from '../api.js';

export function resourceKey(rawPrivateKey, encryptedKey) {
  try {
    const pem = rawPrivateKey.includes('-----BEGIN') ? rawPrivateKey : `-----BEGIN RSA PRIVATE KEY-----\n${rawPrivateKey.match(/.{1,64}/g).join('\n')}\n-----END RSA PRIVATE KEY-----`;
    const decoded = forge.pki.privateKeyFromPem(pem).decrypt(forge.util.decode64(encryptedKey.trim()), 'RSAES-PKCS1-V1_5');
    const key = Buffer.from(decoded, 'binary').subarray(0, 16);
    if (key.length !== 16) throw new Error();
    return key;
  } catch { throw new ApiError('Chiave delle risorse Zanichelli non valida: ripeti l’accesso al libro.'); }
}
export function decryptPage(key, buffer) {
  try {
    // Some editions already deliver plaintext or ordinary gzip resources.
    if (/^\s*(?:<\?xml\b|<svg\b)/i.test(buffer.toString('utf8', 0, 200)) || buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || buffer.subarray(0, 2).equals(Buffer.from([255, 216]))) return buffer;
    let decoded;
    if (buffer[0] === 31 && buffer[1] === 139) decoded = gunzipSync(buffer);
    else {
      const encoded = buffer.toString('utf8').trim();
      if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(encoded)) throw new Error();
      const cipher = createDecipheriv('aes-128-cbc', key, key);
      decoded = Buffer.concat([cipher.update(Buffer.from(encoded, 'base64')), cipher.final()]);
    }
    return decoded[0] === 31 && decoded[1] === 139 ? gunzipSync(decoded) : decoded;
  } catch { throw new ApiError('Pagina Zanichelli danneggiata o formato di protezione non supportato.'); }
}
