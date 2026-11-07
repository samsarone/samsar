import { randomUUID } from 'node:crypto';
import { assistantRequestIdentity } from './AssistantRequestBilling.js';
import { assistantBillingStore } from './AssistantBillingStore.js';
import { createExternalChatCompletion } from './ExternalChatAPI.js';
import { openServerSentEvents } from '../../utils/ServerSentEvents.js';

export async function serveExternalChatStream(req, res, dependencies = {}) {
  const idempotencyKey = req.body?.client_request_id || req.body?.clientRequestId || req.get('Idempotency-Key') || randomUUID();
  const identity = assistantRequestIdentity(req.userId, 'external_chat', req.body, idempotencyKey);
  const stream = openServerSentEvents(res);
  stream.send('request', { requestId: identity.id, idempotencyKey });
  const store = dependencies.store || assistantBillingStore;
  try {
    let result;
    try {
      // Continue generation/settlement after browser disconnects. The same key
      // reconnects to the receipt; it must never start another inference.
      result = await (dependencies.createCompletion || createExternalChatCompletion)({
        userId: req.userId, payload: req.body, idempotencyKey,
        onText: (text, metadata) => stream.send('snapshot', { text, ...metadata }),
      });
    } catch (error) {
      if (error.code !== 'ASSISTANT_REQUEST_IN_PROGRESS') throw error;
      const deadline = Date.now() + 25 * 60 * 1000;
      while (!stream.closed && Date.now() < deadline) {
        const receipt = await store.get(identity.id);
        if (!receipt) throw new Error('Assistant request no longer exists.');
        if (receipt.streamState) stream.send('snapshot', receipt.streamState);
        if (receipt.status === 'COMPLETED') { result = receipt.result; break; }
        if (receipt.status === 'FAILED' || (!receipt.leaseUntil && receipt.errorMessage)) {
          throw Object.assign(new Error(receipt.errorMessage || 'Assistant request failed.'), { code: receipt.errorCode, status: receipt.errorStatus });
        }
        if (receipt.leaseUntil && new Date(receipt.leaseUntil).getTime() < Date.now()) {
          throw Object.assign(new Error('Assistant worker was interrupted. Retry with the same request key to reconcile usage.'), { code: 'ASSISTANT_PROVIDER_OUTCOME_UNKNOWN' });
        }
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    }
    if (result) stream.send('completed', result);
    else if (!stream.closed) stream.send('error', { code: 'ASSISTANT_STREAM_TIMEOUT', message: 'Reconnect with the same request key.' });
  } catch (error) {
    stream.send('error', { code: error.code || 'ASSISTANT_REQUEST_FAILED', message: error.message,
      status: error.status || error.statusCode || 500, requestId: identity.id });
  } finally { stream.end(); }
}
