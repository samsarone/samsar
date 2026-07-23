const DOWNLOAD_RANDOM_BYTE_COUNT = 6;

function createRandomSuffix() {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(DOWNLOAD_RANDOM_BYTE_COUNT);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return Math.random().toString(36).slice(2, 14).padEnd(12, '0');
}

export function createVidgenieDownloadFilename({
  now = new Date(),
  randomSuffix = createRandomSuffix(),
} = {}) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `Rendition_${timestamp}_${randomSuffix}.mp4`;
}
