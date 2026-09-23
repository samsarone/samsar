// Canonical source; sync-projects.sh also packages this in the setup wizard.
import { randomUUID } from 'node:crypto';

export async function validateFalCredential(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const result = (status, extra = {}) => ({
    provider: 'fal', status, ok: status === 'valid',
    validationMode: 'remote_queue_auth', ...extra,
  });
  if (!key) return result('invalid', { message: 'Enter a Fal API key.' });

  // Status reads do not submit inference. A fresh random request ID cannot
  // reference a user's existing job. Only the queue's specific NOT_FOUND
  // response is accepted, with a negative control to verify its auth gate.
  const url = `https://queue.fal.run/fal-ai/elevenlabs/requests/${randomUUID()}/status?logs=0`;
  const probe = (credential) => fetchImpl(url, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json', Authorization: `Key ${credential}` },
  });
  try {
    const response = await probe(key);
    if (response.status === 401 || response.status === 403) {
      await response.arrayBuffer();
      return result('invalid', {
        statusCode: response.status,
        message: 'Fal rejected the API key. Check the key and its permissions.',
      });
    }
    const body = await response.json().catch(() => null);
    if (response.status !== 404 || body?.status !== 'NOT_FOUND') {
      return result('error', {
        statusCode: response.status,
        message: 'Fal authentication could not be confirmed. Retry validation; the key has not been verified.',
      });
    }
    const control = await probe(`${randomUUID()}:${randomUUID().replaceAll('-', '')}`);
    // A public or changed endpoint returning the same 404 for every key must
    // not become another format-only or public-catalog validation shortcut.
    await control.arrayBuffer();
    if (control.status !== 401) {
      return result('error', {
        message: 'Fal authentication could not be confirmed. Retry validation; the key has not been verified.',
      });
    }
    return result('valid', { message: 'Fal authenticated the API key. No generation was started.' });
  } catch {
    return result('error', {
      message: 'Unable to complete the read-only Fal authentication check. Retry validation; the key has not been verified.',
    });
  }
}
