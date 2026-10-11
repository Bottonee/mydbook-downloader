import test from 'node:test';
import assert from 'node:assert/strict';
import { browserUserAgent } from '../electron/login-user-agent.js';

test('login bSmart: identificativo web senza attivare il backend nativo Electron', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
  const electron = chrome.replace('Chrome/', 'MyDbookDownloader/1.2.0 Chrome/').replace('Safari/', 'Electron/44.7.0 Safari/');
  assert.equal(browserUserAgent(electron), chrome);
  assert.equal(browserUserAgent(chrome), chrome);
  assert.equal(browserUserAgent(electron).includes('Electron'), false);
});
