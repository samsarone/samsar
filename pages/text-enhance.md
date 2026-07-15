# Text Enhance

Text enhance turns a user message plus optional metadata into polished marketing copy. The route is implemented in the processor API and stores API chat session records for the user.

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
| Inference model | The user's selected inference model is normalized to `gpt-5.6` or `gemini-3.1-pro`; default is `gpt-5.6`. |
| Provider routing | Native OpenAI or Google Gemini can be used. In Docker, Samsar external inference can be used when `SAMSAR_API_KEY` is configured and the matching native credential is absent. |
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
| Provider | OpenAI, Google Cloud, or Samsar fallback depending on selected inference model and credentials. |
