// imagePreloaderWorkerSingleton.js
const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const STATIC_CDN_URL = import.meta.env.VITE_STATIC_CDN_URL;
let imagePreloaderWorker;

export const getImagePreloaderWorker = () => {
  if (!imagePreloaderWorker) {
    imagePreloaderWorker = new Worker(new URL('./imagePreloaderWorker.jsx', import.meta.url));
    imagePreloaderWorker.postMessage({
      type: 'CONFIG',
      apiServer: API_SERVER,
      staticCdnUrl: STATIC_CDN_URL,
    });
  }
  return imagePreloaderWorker;
};
