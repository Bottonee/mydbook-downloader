import { ApiError, validateToken } from '../api.js';
import { extractConfiguredToken } from './common.js';

const prefix = 'zanichelli-session:';
export function encodeSession(myzToken, idpToken) {
  validateToken(myzToken); validateToken(idpToken);
  const value = prefix + Buffer.from(JSON.stringify({ myzToken, idpToken })).toString('base64url');
  return validateToken(value);
}
export function decodeSession(value) {
  validateToken(value);
  if (!value.startsWith(prefix)) return { myzToken: value };
  try {
    const session = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString());
    return { myzToken: validateToken(session.myzToken), idpToken: validateToken(session.idpToken) };
  } catch { throw new ApiError('Sessione Zanichelli non valida: accedi nuovamente.', 401); }
}
export async function extractSession(source, config) {
  const myzToken = await extractConfiguredToken(source, config);
  if (!myzToken) return null;
  for (const origin of ['https://my.zanichelli.it', 'https://idp.zanichelli.it']) {
    const cookies = await source.cookies.get({ url: origin });
    const token = cookies.find(cookie => cookie.name === 'token' && cookie.value);
    if (token) {
      const value = encodeSession(myzToken, token.value);
      if (!source.rejectedTokens?.has(value)) return value;
    }
  }
  return null;
}
