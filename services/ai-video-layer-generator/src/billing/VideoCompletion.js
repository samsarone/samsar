import { videoBillingMode } from './VideoPricing.js';
import { falLipSyncTariff } from './FalLipSyncTariffs.js';
import { falSoundEffectTariff } from './FalSoundEffectTariffs.js';
import { falVideoTariff } from './FalVideoTariffs.js';

function needsLocalBillingOutput(payload, saved) {
  const receipt = saved.videoBillingReceipt || {};
  if ((receipt.adapter || payload.submittedAdapter) !== 'fal') return false;
  const model = receipt.model || payload.model;
  const lipSync = falLipSyncTariff(model);
  if (lipSync?.basis === 'outputSeconds' && !Object.hasOwn(receipt, 'outputSeconds')) return true;
  const video = falVideoTariff(model);
  if (['millionVideoTokens', 'thousandVideoTokens'].includes(receipt.tariffUnit || video?.unit) &&
      !Object.hasOwn(receipt, 'billableQuantity')) return true;
  return model === 'MIRELOAI' && !Object.hasOwn(receipt, 'requestedSeconds');
}

/** A billing/delivery retry consumes this saved output and cannot submit or
 * poll the provider again. Financial settlement has its own durable identity. */
export async function completeVideoOutput(payload, response, dependencies) {
  try {
    let saved = payload.videoBillingSavedResult;
    if (!saved) {
      const klingInputSeconds = Number(payload.videoBillingNativeReceipt?.inputSeconds);
      const adapterReceipt = response.videoBillingReceipt ? { ...response.videoBillingReceipt } : {
        ...(payload.model === 'KLINGLIPSYNC' && payload.submittedAdapter === 'fal' &&
          Number.isFinite(klingInputSeconds) && klingInputSeconds > 0
          ? { inputSeconds: klingInputSeconds } : {}),
        ...(payload.model === 'HUMMINGBIRDLIPSYNC' ? { requestedSeconds: payload.duration } : {}),
        adapter: payload.submittedAdapter, model: payload.model, providerRequestId: payload.generationId };
      if (payload.submittedAdapter === 'fal' &&
          payload.videoBillingNativeReceipt?.falVideoTariffVersion) {
        Object.assign(adapterReceipt, payload.videoBillingNativeReceipt, {
          adapter: 'fal', model: payload.model, providerRequestId: payload.generationId,
        });
      }
      if (payload.submittedAdapter === 'fal' && falSoundEffectTariff(payload.model)) {
        const native = payload.videoBillingNativeReceipt;
        adapterReceipt.adapter = 'fal';
        adapterReceipt.model = payload.model;
        adapterReceipt.providerRequestId = payload.generationId;
        adapterReceipt.requestedSeconds = native?.requestedSeconds ||
          (payload.model === 'MIRELOAI' ? payload.duration || 10 : 8);
        adapterReceipt.durationSource = native?.requestedSeconds ? 'submitted_config' : 'legacy_queue';
        adapterReceipt.sampleCount = response.videoBillingReceipt?.sampleCount ||
          native?.submittedSamples || (payload.model === 'MIRELOAI' ? 2 : 1);
        adapterReceipt.sampleCountSource = response.videoBillingReceipt?.sampleCount
          ? 'provider_result' : native?.submittedSamples ? 'submitted_config' : 'legacy_default';
      }
      saved = { remoteUrl: response.remoteUrl, videoBillingReceipt: adapterReceipt };
      if (!response.remoteUrl) saved.localVideoLink = await dependencies.downloadBlob(response.responseBlob, payload.sessionId, payload.layerId);
      if (videoBillingMode(payload, dependencies.env || process.env) === 'adapter') {
        // Keep a financial receipt even if the queue is cancelled/deleted
        // between provider completion and the next worker iteration.
        await dependencies.retain?.(payload, saved);
      }
      // Production pipeline mode needs the same durable output identity as
      // adapter billing: retries consume this result instead of polling anew.
      await dependencies.checkpoint(payload._id, saved);
      payload.videoBillingSavedResult = saved;
    }
    // Output-priced Fal calls need a local asset for ffprobe. Keep the remote
    // financial identity first, then add this path to that same durable receipt
    // before settlement; a signed remote URL may already have expired.
    if (videoBillingMode(payload, dependencies.env || process.env) === 'adapter' &&
        needsLocalBillingOutput(payload, saved)) {
      if (!saved.localVideoLink) {
        saved.localVideoLink = await dependencies.download(saved.remoteUrl, payload.sessionId, payload.layerId);
      }
      if (saved.remoteUrl) {
        const financial = await dependencies.attachLocalBillingResult(payload, saved);
        saved.localVideoLink = financial.result?.localVideoLink || saved.localVideoLink;
      }
      await dependencies.checkpoint(payload._id, saved);
      payload.videoBillingSavedResult = saved;
    }
    const receipt = await dependencies.bill(payload, saved);
    if (receipt) await dependencies.recordCharge(payload, receipt);
    if (!saved.localVideoLink) {
      saved.localVideoLink = await dependencies.download(saved.remoteUrl, payload.sessionId, payload.layerId);
      await dependencies.checkpoint(payload._id, saved);
    }
    await dependencies.deliver(payload, saved.localVideoLink);
    return receipt;
  } catch (error) {
    if (videoBillingMode(payload, dependencies.env || process.env) !== 'adapter') throw error;
    // Never send a paid/completed provider call through generation failover.
    throw Object.assign(error, { videoBillingPending: true, code: 'VIDEO_BILLING_PENDING' });
  }
}
