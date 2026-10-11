import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { decodeImage } from '../src/image-codec.js';
export class ImageConverter {
  constructor() { this.window = null; this.ready = null; }
  async convert(payload) {
    this.ready ??= (async () => {
      this.window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'image-converter', backgroundThrottling: false } });
      this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await this.window.loadFile(fileURLToPath(new URL('./codec.html', import.meta.url)));
    })();
    await this.ready;
    return this.window.webContents.executeJavaScript(`(${decodeImage.toString()})(${JSON.stringify(payload)})`);
  }
  close() { if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; this.ready = null; }
}
