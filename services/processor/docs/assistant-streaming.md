# Assistant streaming and settlement

Streaming is opt-in. Existing JSON completions, queued submissions and status polling retain their response contracts. No database migration or new service is required; the new Mongo fields have defaults for older sessions and jobs. Roll out the processor and assistant worker before enabling the updated client. The generated monorepo must be synced separately from these source repositories.

## Studio assistant

Submit through `POST /assistants/submit_assistant_query` with the existing user authorization, session `id`, `query`, and optional frame/model settings. Add:

```json
{
  "stream": true,
  "client_request_id": "a-unique-key-for-this-message",
  "assistantSessionVersion": 0
}
```

Use the session's current `assistantSessionVersion`, not a hard-coded zero. Reuse the same request key and payload after an uncertain submission result. Replays append/queue once; changed payloads under the same key conflict. Omitting streaming and request-key fields preserves legacy submission behavior.

Subscribe with authenticated `fetch` to `GET /assistants/assistant_query_stream?id=SESSION_ID`. Native `EventSource` cannot set the required Authorization header. The SSE events are:

| Event | Meaning |
| --- | --- |
| `snapshot` | Current conversation, version, pending/error state, and cumulative `assistantStream.text`. Replace the displayed state instead of appending text. Image attachments are represented by markers, without repeating their encoded bytes. |
| `settled` | This session is no longer pending. Inspect the snapshot for completion or failure. |
| `reconnect` | Reopen the GET connection; the next snapshot contains current state. |
| `error` | Stream failure, with `message`, `code` and HTTP-style `status`. Authentication/access failures must stop reconnecting. |

Snapshots are read every 750 ms and changed snapshots are sent. The worker publishes the first text immediately, then coalesces writes at approximately 300 ms with one storage write in flight. A trailing timer flushes buffered text even when the provider pauses. Connections rotate after 30 seconds, and heartbeats are sent every 10 seconds. Event IDs identify the conversation version, query and snapshot sequence; reconnects replay current state rather than maintaining a delta log.

The client also polls `GET /assistants/assistant_query_status?id=SESSION_ID&include_messages=true` with authorization. This opt-in returns `{status, sessionDetails}` with the same lightweight conversation snapshot while pending or complete, so live text still appears if SSE is buffered or unavailable. Without `include_messages=true`, the legacy REST contract is unchanged. Both transports replace the same provisional reply; lower sequences and late partials after completion cannot overwrite newer text. Temporary network/server failures keep polling active; access failures cancel delivery, as do clearing or leaving the session.

`POST /assistants/reset_session_messages` clears assistant history and visible partial output, removes old queued requests, and increments the conversation version. In-flight replies cannot restore cleared history. Already-incurred provider usage still settles once. Pending billing receipts remain available until settlement; completed queued receipts retain accounting metadata without a second copy of conversation content. Clearing does not delete project layers or media.

## External chat SSE

Send `stream: true` to `POST /v2/external/chat/completions` with the existing API authentication and a stable `Idempotency-Key`. Existing external chat/assistant route aliases use the same handler. Streaming cannot be combined with async polling mode.

This is the Samsar SSE protocol, not OpenAI's `chat.completion.chunk` wire format:

| Event | Data |
| --- | --- |
| `request` | `requestId`, `idempotencyKey` — retain these for reconnect/reconciliation. |
| `snapshot` | Cumulative `text` plus progress metadata. Replace the prior text. |
| `completed` | `{ response, creditsCharged, remainingCredits }` — the existing complete response and settled receipt. |
| `error` | `{ code, message, status, requestId }` — terminal for this connection. |

The final credits belong to the `completed` event, because response headers were already sent. Non-streaming REST still returns its existing JSON response and credit headers. Reposting the same payload/key watches an active request or returns its saved result. REST and SSE share the same request identity, so a REST replay can retrieve a streamed completion without generating or charging again.

The `samsar-js` source adds `streamV2ExternalChatCompletion(payload, { idempotencyKey, onText, onEvent, signal })`. `onText` receives cumulative snapshots. It returns the existing `SamsarResult` shape including `creditsCharged` and `creditsRemaining`. Set the SDK's `timeoutMs` high enough for the chosen model; the normal SDK default remains 30 seconds. Aborting the client connection stops delivery, not provider generation or settlement. The SDK does not automatically resubmit inference.

## Provider and billing behavior

OpenAI Responses, OpenAI-compatible chat adapters (including Qwen, Kimi and OpenRouter), native Anthropic, native Gemini, and the hosted Samsar adapter consume provider streams when given the internal `onText` callback. Calls without that callback continue using complete REST responses. Private thinking is not published as answer text; final provider metadata and usage are retained for billing. The hosted adapter uses direct SSE transport so existing installed SDK versions do not prevent worker streaming.

Settlement uses measured provider token usage and the existing checked-in model tariffs, with the existing **1.2 multiplier applied once** and existing fractional credit rounding. Cumulative usage events replace previous counts; they are never summed as deltas. Cache reads/writes follow the existing rates, and reasoning tokens already included in output are not added twice. Provider monetary estimates remain audit data. Standalone deployments preserve their existing local billing waiver; a hosted Samsar request is settled by the host.

Provider usage is saved before settlement. Lease ownership protects concurrent workers; renewal allows long generations, and late authoritative receipts can be handed off after lease loss. The balance decrement uses an atomic idempotency marker, and ledger/delivery retries reuse the same receipt and debit key. Recovery can settle saved responses after a process restart without calling a provider again.

| Failure | Behavior |
| --- | --- |
| Browser disconnect, callback failure, slow consumer | Generation continues to collect usage; reconnect with the same key/snapshot endpoint. Slow snapshot storage is coalesced and does not block token consumption. |
| Provider HTTP rejection before a stream begins | A visible error; no fabricated token usage or debit. Existing safe adapter selection behavior is retained. |
| Truncated/malformed stream, timeout after dispatch, worker interruption without a final receipt | No automatic inference retry/failover. Retain the billing identity for reconciliation; interrupted partial output is display-only and does not enter assistant conversation history. |
| Missing/invalid final usage or unpriced paid tool usage | Do not guess a charge or silently mark the request free. Keep the receipt pending reconciliation and stop the session spinner. |
| Database/ledger/delivery failure after receipt collection | Retain the response and retry settlement; a prior debit is not repeated. |
| Clear session while generating | Drop old UI/history writes, retain settlement for incurred usage, and allow a new conversation. |

When the provider never supplies an authoritative final usage receipt, exact automatic billing cannot be reconstructed from visible text. These requests require an authoritative provider receipt before reconciliation; missing-usage receipts are excluded from automatic recovery loops. For a repaired receipt, retry the original external request key or clear its reconciliation error after attaching verified usage so normal recovery can resume. Do not generate again under the original identity.

## Proxy and verification

SSE responses send `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`, and flush compression middleware after each event. Disable response buffering/caching at every proxy hop for these routes: an inner Nginx can consume `X-Accel-Buffering` before an outer proxy sees it. Keep idle timeouts above the heartbeat interval, and allow an external stream to remain open for the provider request timeout. No infrastructure configuration is deployed by this source change.

Relevant checks:

```sh
# samsar_processor
npm run build
npm run test:assistant-billing
node --test src/inference/ProviderStreaming*.test.js src/models/Assistant.session.test.js src/models/SceneActions.session.test.js src/utils/ServerSentEvents.test.js src/routes/assistants.streaming.test.js src/models/api/ExternalChatStreaming.test.js

# samsar_assistant_query_processor
npm test

# samsar-js
npm test

# samsar_client
npm run test:unit -- test/unit/AssistantSession.test.jsx test/unit/AssistantStreaming.test.jsx
npm run test:browser -- test/browser/AssistantSession.test.jsx
```
