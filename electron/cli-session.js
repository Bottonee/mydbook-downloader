import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { TokenVault } from './token-vault.js';
import { getProvider } from '../src/providers/index.js';
export function isSessionPipe(pipe) {
  if (typeof pipe !== 'string') return false;
  const prefix = '\\\\.\\pipe\\mydbook-';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return process.platform === 'win32' ? pipe.startsWith(prefix) && uuid.test(pipe.slice(prefix.length)) : path.dirname(pipe) === os.tmpdir() && /^mydbook-[0-9a-f-]{36}\.sock$/i.test(path.basename(pipe));
}
export async function sendCliSession(pipe, id, dataDir, { quit = true } = {}) {
  if (!isSessionPipe(pipe)) throw new Error('Canale locale della sessione non valido.');
  const close = () => { if (quit) app.quit(); };
  const connection = net.createConnection(pipe);
  connection.on('error', close);
  connection.on('connect', async () => {
    let result;
    try {
      const provider = getProvider(id);
      const vault = new TokenVault(dataDir, safeStorage, process.platform, provider.id);
      result = { ok: true, token: await vault.load() };
    } catch { result = { ok: false, message: 'Impossibile leggere la sessione cifrata. Accedi nuovamente dall’app desktop.' }; }
    connection.end(JSON.stringify(result), close);
  });
}
