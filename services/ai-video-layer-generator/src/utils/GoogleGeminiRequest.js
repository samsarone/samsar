import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const identifier = (value) => typeof value === 'string' ? value.slice(0, 200) : null;
const code = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
const numeric = (value) => Number.isFinite(Number(value)) && value != null ? Number(value) : null;

/** One dispatch, with a deadline that remains active until its complete body is read. */
export async function runGoogleGeminiRequest(url, request, options = {}) {
  const parsedTimeout = Number(options.timeoutMs ?? process.env.GOOGLE_GEMINI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? Math.floor(parsedTimeout) : DEFAULT_TIMEOUT_MS;
  const logger = options.logger || console;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const startedAt = Date.now();
  const context = {
    requestId: randomUUID(),
    sessionId: identifier(options.sessionId),
    requestKey: identifier(options.requestKey),
    model: identifier(options.model),
    transport: options.transport || null,
    timeoutMs,
    streaming: Boolean(options.onText),
  };
  const log = (level, event, details = {}) => {
    // Logging must never turn a completed provider response into a retry.
    try { logger[level]?.('[inference][google_gemini] ' + event, {
      ...context, elapsedMs: Date.now() - startedAt, ...details,
    }); } catch {}
  };
  const controller = new AbortController();
  let response;
  let phase = 'headers';
  let timeoutId;
  let timedOut = false;
  let responsePayloadParsed = false;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      const error = Object.assign(new Error(`Google Gemini request timed out after ${timeoutMs}ms.`), {
        name: 'GoogleGeminiTimeoutError', code: 'ETIMEDOUT', status: 504,
        requestId: context.requestId, providerOutcomeUncertain: true, retryable: false,
      });
      // Settle the deadline even if a mocked or broken body ignores AbortSignal.
      reject(error);
      controller.abort(error);
      try {
        const cancellation = response?.body?.destroy?.() ?? response?.body?.cancel?.();
        cancellation?.catch?.(() => {});
      } catch {}
    }, timeoutMs);
  });
  log('info', 'request_started');
  try {
    const payload = await Promise.race([
      Promise.resolve().then(async () => {
        response = await fetchImpl(url, { ...request, signal: controller.signal });
        if (controller.signal.aborted) throw controller.signal.reason;
        phase = 'body';
        log('info', 'response_headers', { httpStatus: numeric(response.status) });
        const streamedPayload = response.ok && options.onText
          ? await options.collectStream(response.body, options.onText)
          : null;
        let payload;
        if (streamedPayload) payload = streamedPayload;
        else if (typeof response.text === 'function') {
          const responseText = await response.text();
          try { payload = responseText ? JSON.parse(responseText) : {}; }
          catch (error) {
            if (response.ok) throw error;
            payload = {};
          }
        } else payload = await response.json();
        responsePayloadParsed = true;
        if (!response.ok) {
          throw Object.assign(new Error(
            payload?.error?.message || `Google Gemini inference failed with status ${response.status}`,
          ), {
            status: response.status,
            code: payload?.error?.code ?? response.status,
            error: {
              code: payload?.error?.code ?? null,
              status: payload?.error?.status ?? null,
              message: payload?.error?.message ?? null,
            },
          });
        }
        return payload;
      }),
      timeoutPromise,
    ]);
    const candidate = payload?.candidates?.[0] || {};
    const text = (Array.isArray(candidate.content?.parts) ? candidate.content.parts : [])
      .map(part => typeof part?.text === 'string' ? part.text : '').join('');
    const usage = payload?.usageMetadata;
    log(text.trim() ? 'info' : 'warn', 'request_completed', {
      httpStatus: numeric(response?.status),
      providerRequestId: identifier(payload?.responseId),
      finishReason: code(candidate.finishReason),
      blockReason: code(payload?.promptFeedback?.blockReason),
      candidateCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
      characterCount: Array.from(text.trim()).length,
      usage: usage ? {
        promptTokens: numeric(usage.promptTokenCount),
        candidateTokens: numeric(usage.candidatesTokenCount),
        thinkingTokens: numeric(usage.thoughtsTokenCount),
        totalTokens: numeric(usage.totalTokenCount),
      } : null,
    });
    return payload;
  } catch (error) {
    let failure = error;
    if (!responsePayloadParsed) {
      // A lost connection or unreadable success body cannot prove whether the
      // provider completed the POST. Callers must not replay this request.
      if (!failure || typeof failure !== 'object' || !Object.isExtensible(failure)) {
        failure = new Error('Google Gemini response could not be received.', { cause: error });
      }
      Object.assign(failure, {
        providerOutcomeUncertain: true, retryable: false, requestId: context.requestId,
      });
    }
    log('error', timedOut ? 'request_timed_out' : 'request_failed', {
      phase, httpStatus: numeric(response?.status ?? failure?.status),
      errorName: code(failure?.name), errorCode: code(failure?.code),
      providerOutcomeUncertain: failure?.providerOutcomeUncertain === true,
    });
    throw failure;
  } finally {
    clearTimeout(timeoutId);
  }
}
