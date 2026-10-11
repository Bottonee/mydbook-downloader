import net from 'node:net';
import { app, safeStorage } from 'electron';
import { TokenVault } from './token-vault.js';
import { getProvider } from '../src/providers/index.js';
export async function sendCliSession(pipe, id, dataDir) {
  const connection = net.createConnection(pipe);
  connection.on('error', () => app.quit());
  connection.on('connect', async () => {
    let result;
    try {
      const provider = getProvider(id);
      const vault = new TokenVault(dataDir, safeStorage, process.platform, provider.id);
      result = { ok: true, token: await vault.load() };
    } catch { result = { ok: false, message: 'Impossibile leggere la sessione cifrata. Accedi nuovamente dall’app desktop.' }; }
    connection.end(JSON.stringify(result), () => app.quit());
  });
}
