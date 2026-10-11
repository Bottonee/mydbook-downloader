import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../src/api.js';
export class TokenVault {
  constructor(folder, storage, platform = process.platform) { this.file = path.join(folder, 'token.bin'); this.storage = storage; this.platform = platform; }
  available() { return this.storage.isEncryptionAvailable() && (this.platform !== 'linux' || this.storage.getSelectedStorageBackend() !== 'basic_text'); }
  async load() {
    if (!this.available()) return null;
    try { return this.storage.decryptString(await readFile(this.file)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new ApiError('Il token salvato non è leggibile. Incollalo di nuovo o disattiva Ricordami.'); }
  }
  async save(token) {
    if (!this.available()) throw new ApiError('Archivio sicuro del sistema non disponibile. Disattiva Ricordami per continuare senza salvare il token.');
    const ciphertext = this.storage.encryptString(token);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file + '.part', ciphertext, { mode: 0o600 });
    await rename(this.file + '.part', this.file);
  }
  async forget() {
    for (const file of [this.file, this.file + '.part']) try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
