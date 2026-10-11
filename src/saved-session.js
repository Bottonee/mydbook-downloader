import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ApiError } from './api.js';
import { getProvider } from './providers/index.js';

// Electron decrypts safeStorage on the same OS/account; the token travels only over a local pipe.
export async function loadSavedSession(id) {
  getProvider(id);
  const { default: executable } = await import('electron');
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\mydbook-${randomUUID()}` : path.join(os.tmpdir(), `mydbook-${randomUUID()}.sock`);
  return new Promise((resolve, reject) => {
    let child, timer, received = false, settled = false;
    const server = net.createServer(socket => {
      let data = '';
      socket.setTimeout(15000, () => socket.destroy());
      socket.on('error', () => finish(new ApiError('Lettura della sessione interrotta.')));
      socket.on('data', chunk => { data += chunk; if (data.length > 20000) { socket.destroy(); finish(new ApiError('Sessione salvata non valida.')); } });
      socket.on('end', () => {
        try { const value = JSON.parse(data); received = true; value.ok ? finish(null, value.token) : finish(new ApiError(value.message)); }
        catch { finish(new ApiError('Sessione salvata non leggibile.')); }
      });
    });
    const finish = (error, token) => { if (settled) return; settled = true; clearTimeout(timer); server.close(); child?.kill(); error ? reject(error) : resolve(token); };
    server.on('error', () => finish(new ApiError('Impossibile aprire il canale locale per leggere la sessione.')));
    server.listen(pipe, () => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(executable, [fileURLToPath(new URL('..', import.meta.url)), '--cli-session', pipe, '--provider', id], { env, stdio: 'ignore', windowsHide: true });
      child.on('error', () => finish(new ApiError('Electron non disponibile. Installa le dipendenze e accedi dall’app desktop.')));
      // A successful secondary process can exit before the running app replies
      // on the pipe. Keep waiting for that reply, bounded by the existing timeout.
      child.on('exit', code => { if (!received && code !== 0) finish(new ApiError('Sessione cifrata non disponibile. Accedi dall’app desktop.')); });
      timer = setTimeout(() => finish(new ApiError('Lettura della sessione scaduta. Apri l’app desktop e accedi.')), 30000);
    });
  });
}
