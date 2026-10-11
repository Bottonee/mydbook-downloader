import { mydbookConfig } from './providers/mydbook.config.js';
export const config = Object.freeze({
  ...mydbookConfig,
  concurrency: 4,
  delayMs: 250,
  retries: 5,
  timeoutMs: 45000,
  tmpDir: './tmp',
  outputDir: './output',
});
