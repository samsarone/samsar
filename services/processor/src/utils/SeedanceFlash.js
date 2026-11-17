import { isPrivateOrLocalHostname } from './PublicNetworkAddress.js';

export const SEEDANCE_FLASH_MODEL_KEY = 'SEEDANCE2.5FLASHI2V';

export function isSeedanceFlashModel(model) {
  return typeof model === 'string' && model.trim().toUpperCase() === SEEDANCE_FLASH_MODEL_KEY;
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: 'SEEDANCE_FLASH_INVALID_INPUT' });
}

export function normalizeSeedanceFlashVideoOptions(payload = {}) {
  const duration = Number(payload.duration ?? 5);
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) {
    throw invalid('Seedance 2.5 Flash duration must be a whole number from 4 to 30 seconds.');
  }
  const resolution = String(payload.resolution || '720p').trim().toLowerCase();
  if (!['480p', '720p'].includes(resolution)) {
    throw invalid('Seedance 2.5 Flash resolution must be 480p or 720p.');
  }
  const bitrateMode = String(payload.bitrate_mode || payload.bitrateMode || 'standard').trim().toLowerCase();
  if (!['standard', 'high'].includes(bitrateMode)) {
    throw invalid('Seedance 2.5 Flash bitrate_mode must be standard or high.');
  }
  const requestedCodec = String(payload.codec || 'auto').trim().toUpperCase();
  if (!['AUTO', 'H264', 'H265'].includes(requestedCodec)) {
    throw invalid('Seedance 2.5 Flash codec must be auto, H264 or H265.');
  }
  const endImage = payload.end_image_url ?? payload.endImage ?? payload.endImageUrl ?? '';
  let endUrl;
  if (endImage) {
    try { endUrl = new URL(endImage); } catch { throw invalid('end_image_url must be a public http(s) URL.'); }
    if (!['http:', 'https:'].includes(endUrl.protocol) || isPrivateOrLocalHostname(endUrl.hostname)) {
      throw invalid('end_image_url must be a public http(s) URL.');
    }
  }
  return {
    duration,
    resolution,
    bitrate_mode: bitrateMode,
    codec: requestedCodec === 'AUTO' ? 'auto' : requestedCodec,
    ...(endUrl ? { endImage: endUrl.toString() } : {}),
  };
}
