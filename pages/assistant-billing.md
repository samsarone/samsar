# Assistant Billing and Retries

Assistant and public chat/assistant endpoints use the final customer token prices below. Production agent pipeline inference retains its flat stage pricing.

## Final Token Prices

All prices are **credits per one million tokens**. Each row applies to the specified model, adapter, context, and date period. Date periods use UTC. Cached input means cached-read tokens. These tables cover model tokens; separately priced tools have their own charges.

| Model | Adapter | Context / date period | Input | Cached input | Output |
| --- | --- | --- | ---: | ---: | ---: |
| `gpt-6-astra` | OpenAI | ≤ 272k input tokens | 1,200 | 120 | 6,000 |
| `gpt-6-astra` | OpenAI | > 272k input tokens | 2,400 | 240 | 9,000 |
| `gpt-6.1-sol` | OpenAI | ≤ 272k input tokens | 240 | 12 | 1,200 |
| `gpt-6.1-sol` | OpenAI | > 272k input tokens | 480 | 24 | 1,800 |
| `claude-opus-5.5` | Anthropic | Standard | 480 | 24 | 2,400 |
| `claude-fable-5.1` | Anthropic / OpenRouter | Standard | 1,200 | 30 | 6,000 |
| `gemini-4-carbon` | Google global | Through Nov 30, 2026 | 240 | 12 | 1,200 |
| `gemini-4-carbon` | Google global | From Dec 1, 2026 | 480 | 24 | 2,400 |
| `gemini-4-carbon` | Google regional | Through Nov 30, 2026 | 264 | 13.2 | 1,320 |
| `gemini-4-carbon` | Google regional | From Dec 1, 2026 | 528 | 26.4 | 2,640 |
| `QWEN3.8` | Alibaba international | Standard | 240 | 30 | 720 |
| `kimi-k3` | Moonshot | Standard | 360 | 36 | 1,800 |

GPT Astra/Sol and Claude Opus/Fable support High and XHigh at the same per-token rates. Charges follow actual token usage. Other adapter routes may have different final prices. Credit receipts report the final charge for a completed request. See the [public pricing reference](https://docs.samsar.one/pricing) for the shared assistant and external-chat rate tables.

## Scope

| Request | Billing |
| --- | --- |
| Session assistant completion: `/v1/assistant/completion` and `/v2/assistant/completion` | Published token prices for the selected route. |
| External-user session assistant: `/v1/external_users/assistant/completion` | Same token prices, using the billing account for that identity. |
| Public `/v2/external/chat`, `/v2/external/chat/completions`, `/v2/external/assistant`, and `/v2/external/assistant/completions` | Same token prices for JSON, streaming, and queued requests. |
| Hosted Studio queued assistant worker | Same published token prices. |
| Standalone Studio queued assistant worker | Existing local-credit waiver; native providers or a hosted Samsar adapter can still bill their own accounts. |
| Production agent pipeline inference | Existing flat stage pricing, regardless of adapter. |

Image/video/audio routes, narrative generation, image titles, publication metadata, and other utility operations retain their own published rates.

## Credit Balances

The authenticated billing scope determines which balance pays. Standard external users use their allocated external balance. Internal-mapped external users debit the owning internal account; a configured customer sub-account budget is also consumed once as a spending limit. That budget is not a second charge to the internal balance. API-key attribution is retained for queued settlement and recovery.

A positive balance and sufficient API-key allowance are required before a request starts. The final charge can exceed the available balance; further requests are rejected until credits are restored.

## Retries and Settlement

Save one request key for each logical submission and reuse it if the response is lost:

```js
const payload = {
  model: 'gpt-6-astra',
  messages: [{ role: 'user', content: 'Write a launch caption.' }],
};
const options = { idempotencyKey: 'launch-caption-001' };
const result = await samsar.createV2ExternalChatCompletion(payload, options);
```

The SDK sends `Idempotency-Key`. Queued external submissions also accept `client_request_id`, which can be used for status lookup. If both a client request ID and header key are supplied, the client request ID identifies the request. Keys are scoped to the authenticated account and request scope; a session assistant also scopes the key to its session and external identity. Use a non-empty string of at most 512 characters.

- The same key and payload return the completed response and original charge. Reusing the key with a changed payload returns `409`.
- A replay's `x-credits-charged` header reports the original debit. It does not represent another debit. Polling does not create another inference charge.
- Requests without a stable key are separate submissions, even when their text is identical.
- Requests awaiting billing confirmation or completion after a timeout can remain pending. Continue checking the existing request using the same key.

Default public queue-status retention is 24 hours. Requests still awaiting completion can remain pending beyond that period.

## Streaming and Conversation Reset

The public external chat/assistant completion routes accept `stream: true` when polling mode is off. They emit named SSE events: `request`, cumulative-text `snapshot`, `completed`, and `error`. The `completed` event carries the response and settled credit receipt. Reconnect with the same request key; a dropped connection does not cancel provider work. The synchronous `/v1/assistant/completion` session API remains a separate JSON contract. See the [streaming API contract](https://docs.samsar.one/external-requests#streaming-completion).

The Studio popup submits queued work through `/assistants/submit_assistant_query` and receives snapshots from `/assistants/assistant_query_stream`; `/assistants/assistant_query_status` remains available for polling. Clearing the conversation removes its messages, invalidates pending replies, and prevents stale workers from repopulating the cleared history. Project media remains intact. Usage already incurred can still settle, and accounting records are retained; clearing chat is not a refund.

## Paid Tools and Pending Requests

Image generation, web/file search, hosted code execution, and similar paid tools may incur separate charges. Requests using these tools can remain pending until billing is confirmed. Keep the original request key while checking completion.

Public API billing is described in the [Assistant API](https://docs.samsar.one/assistant-api) and [external assistant API](https://docs.samsar.one/external-requests#external-assistant-and-chat-completions). Credit receipts appear in `x-credits-charged` / `x-credits-remaining`; completed queued responses also include `creditsCharged` / `remainingCredits`.

## Regression Checks

From the monorepo root with workspace dependencies installed:

```bash
npm run test:assistant-billing --workspace services/processor
npm test --workspace services/assistant-query-processor
npm run test:credits-security --workspace services/processor
```

The suites cover final token prices, cached tokens, reasoning usage, free responses, concurrent requests, idempotent replay, failure recovery, external-user balances, customer budgets, pending billing confirmation, and unchanged production agent stage pricing. SDK request-option and credit-header checks live in the separate `samsar-js` repository (`npm test`).

Gemini inference and vision default to Carbon with High thinking. Legacy Argon selections resolve to Carbon; historical billing receipts keep their original model identity.
