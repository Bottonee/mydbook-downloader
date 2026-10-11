import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { TokenVault } from '../electron/token-vault.js';
import { ApiError, validateToken } from '../src/api.js';
import { userError } from '../electron/errors.js';
test('token cifrato su disco, ripristino, cancellazione e backend non sicuro rifiutato', async () => {
  await mkdir('tmp', { recursive: true });
  const folder = await mkdtemp(path.resolve('tmp/vault-test-'));
  const key = randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: token => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString: data => { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(); },
  };
  const vault = new TokenVault(folder, storage);
  await vault.save('fake-private-test-token');
  assert.equal((await readFile(vault.file)).includes(Buffer.from('fake-private-test-token')), false);
  assert.equal(await vault.load(), 'fake-private-test-token');
  await vault.forget(); assert.equal(await vault.load(), null);
  const mydbookVault = new TokenVault(folder, storage, process.platform, 'mydbook');
  const bsmartVault = new TokenVault(folder, storage, process.platform, 'bsmart');
  await mydbookVault.save('first-fixture'); await bsmartVault.save('second-fixture');
  await mydbookVault.forget(); assert.equal(await mydbookVault.load(), null); assert.equal(await bsmartVault.load(), 'second-fixture');
  const unsafe = new TokenVault(folder, { ...storage, getSelectedStorageBackend: () => 'basic_text' }, 'linux');
  await assert.rejects(unsafe.save('fake-token'), /Archivio sicuro/);
  assert.throws(() => validateToken('a;cookie=value'), /formato non valido/);
  assert.throws(() => validateToken('a\r\nb'), /formato non valido/);
  assert.match(userError(new ApiError('expired', 401)), /Token scaduto/);
  assert.equal(userError(new ApiError('fake-private-test-token'), 'fake-private-test-token'), '[omesso]');
});
