// Conversione DOM condivisa tra CLI ed Electron.
export async function decodeImage({ base64, format, quality }) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  // Accetta soltanto PNG, JPEG o WebP; non esegue HTML/SVG restituiti per errore.
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('Formato immagine non supportato');
  const blob = new Blob([bytes], { type: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Dimensioni non valide');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (format === 'jpeg') {
      // JPEG non supporta alpha: il foglio trasparente deve diventare bianco.
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0);
    return canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', quality / 100).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}
