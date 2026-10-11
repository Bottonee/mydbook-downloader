import assert from 'node:assert/strict';
import { listPackage } from '@electron/asar';
const entries = listPackage('dist/win-unpacked/resources/app.asar').map(entry => entry.replaceAll('\\', '/'));
const forbidden = entries.filter(entry => /\/(?:playwright|playwright-core)(?:\/|$)|\/[^/]*\.env$|\/(?:tmp|output|discovery-private|test|\.github)(?:\/|$)|\/token\.bin$/.test(entry));
assert.deepEqual(forbidden, [], 'Il pacchetto contiene file esclusi');
assert.ok(entries.includes('/electron/main.js'));
assert.ok(entries.includes('/electron/download-worker.js'));
assert.ok(entries.includes('/src/pdf.js'));
console.log('Pacchetto verificato: nessun Playwright, .env, cache, output o token.bin.');
