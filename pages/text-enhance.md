# Text Enhance

Text enhance turns a user message plus optional metadata into polished marketing copy. The route is implemented in the processor API and stores API chat session records for the user.

## Hosted Samsar.js

[Hosted enhancement API](https://docs.samsar.one/chat-api#post-chatenhance) · [Inference matrix](model-matrix.md#inference) · [Native inference adapters](providers-and-models.md)

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const copy = await samsar.enhanceMessage({
  message: 'Launch discount for a new skincare product',
  metadata: { audience: 'busy professionals', tone: 'warm and concise' },
  language: 'en',
  maxwords: 120,
});
console.log(copy.data.content);
```

The hosted client uses Samsar’s inference routing. A standalone installation can use the native adapter for its selected inference model, followed by the compatible configured alternatives.

## Endpoint

```text
POST /v1/chat/enhance
```

Health check:

```text
GET /v1/chat/health
```

## Auth

The route accepts a Samsar API key, user auth token, or app key where supported by the auth resolver.

## Request Body

| Field | Required | Meaning |
| --- | --- | --- |
| `message` | Yes | Source message to enhance. Must be a non-empty string. |
| `metadata` | No | Object with private context such as audience, product, offer, tone, channel, differentiators, or constraints. The prompt uses this for context without echoing the fields. |
| `language` | No | Language code. Defaults to auto behavior when omitted. |
| `maxwords` or `maxWords` | No | Positive integer up to 1500. Defaults to 800. The generated target range is roughly 62.5-75 percent of this cap. |

Example:

```json
{
  "message": "Launch discount for a new skincare product",
  "metadata": {
    "audience": "busy professionals",
    "tone": "premium but direct",
    "offer": "20 percent launch discount"
  },
  "language": "en",
  "maxwords": 120
}
```

Response:

```json
{
  "content": "..."
}
```

## Runtime Behavior

| Step | Behavior |
| --- | --- |
| Credit charge | The processor charges the configured chat enhance credit cost before generation. |
| Inference model | The processor normalizes the selected inference model; current default is `gpt-6-astra`. See the [inference matrix](model-matrix.md#inference) for Claude, Gemini, Kimi, Qwen and reasoning options. |
| Provider routing | Standalone uses the selected model's compatible configured adapter order. Hosted `QWEN3.8` always uses OpenRouter; native Alibaba Qwen is Docker-only. |
| Persistence | Successful and failed API chat sessions are saved with metadata, input, output/error, model, and credit information. |
| Refunds | If generation fails after credit charge, the route attempts to refund the charged credits. |

Credit headers:

| Header | Meaning |
| --- | --- |
| `x-credits-charged` | Credits charged for the request. |
| `x-credits-remaining` | Remaining user credits when available. |

## Docker Services

| Service | Role |
| --- | --- |
| `processor` | Route, auth, credits, prompt construction, provider call, session persistence. |
| `mongo` | User, credit, and API chat state. |
| Provider | OpenAI, Google Cloud, OpenRouter, Docker-only native Alibaba Qwen, or the Samsar fallback depending on model, deployment mode, and credentials. |
