// Keep the actual Chromium/platform versions, but avoid bSmart's native-app detection.
export function browserUserAgent(userAgent) {
  return userAgent.replace(/\s+Electron\/[\w.-]+/gi, '').replace(/\s+[^\s/]+\/[\w.-]+(?=\s+Chrome\/)/g, '');
}
