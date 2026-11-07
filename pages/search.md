# Search

Samsar search is built on reusable embedding templates. A template is created from JSON records, URLs, or cleaned plain text. Queries search against a template and return matched records plus structured filter metadata.

## Hosted Samsar.js

[Hosted search and embeddings](https://docs.samsar.one/chat-api#post-chatcreate_embedding) · [Embedding model matrix](model-matrix.md#embeddings) · [Recommendations](recommendations.md)

Start with Samsar.js for a managed index and query:

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const index = await samsar.createEmbedding({
  name: 'catalog',
  records: [{ id: 'camera-1', description: 'Compact camera for travel photography' }],
});
const results = await samsar.searchAgainstEmbedding({
  template_id: index.data.template_id,
  search_term: 'a lightweight travel camera',
});
console.log(results.data);
```

For large or queued ingestion, inspect [embedding status](https://docs.samsar.one/chat-api#get-chatembedding_status) before querying. In your own deployment, the current local embedding implementation requires an OpenAI key; URL crawling additionally requires Firecrawl. Those are local implementation requirements, not extra keys for a hosted Samsar.js caller.

## Docker Services

| Service | Role |
| --- | --- |
| `processor` | Auth, input validation, embedding creation, search, filtering, credit headers, and status endpoints. |
| `mongo` | Stores embedding templates, records, status, user state, and credit state. |
| Provider | OpenAI embeds template content and search queries; Firecrawl supplies URL ingestion. |

## Create an Index

| Endpoint | Input source | Notes |
| --- | --- | --- |
| `POST /v1/chat/create_embedding` | `records`, `data`, `items`, `json`, `documents`, or `urls` | Generic create endpoint. Records must be a non-empty array or URL input must contain at least one URL. |
| `POST /v1/chat/create_embedding_from_url` | `urls`, `url_list`, `source_urls`, or `url` | Crawls URL sources and returns processed/skipped/crawl metadata when available. |
| `POST /v1/chat/generate_embeddings_from_plain_text` | `plain_text`, `plain_texts`, `texts`, `documents`, `items`, `entries`, or text-like content fields | Creates templates from plain text. |
| `POST /v1/chat/update_embedding` | `template_id` plus records | Upserts submitted source IDs (replaces matching IDs and adds new IDs); other template records remain. |

Common optional fields:

| Field | Purpose |
| --- | --- |
| `name`, `embedding_name`, `template_name` | Human-readable template label. |
| `field_options`, `field_config`, `column_types` | Structured/unstructured field controls. |
| `ttl_minutes` | Positive integer TTL. Response includes `expires_at` when set. |
| `levels`, `crawl_levels`, `max_depth` | URL crawl depth controls for URL-based indexing. |

Create responses include `template_id`, `template_hash`, `hash_link`, record counts, structured fields, unstructured fields, and credit headers when applicable.

## Query Search

Primary endpoints:

```text
POST /v1/chat/search_against_embedding
POST /v1/chat/search_against_embeddings
```

Required fields:

| Field | Meaning |
| --- | --- |
| `template_id` | The embedding template to query. |
| `search_term` or `query` | The natural-language search query. |

Optional fields:

| Field | Meaning |
| --- | --- |
| `search_params`, `search_filters`, `filter_payload`, `pre_filter` | Structured filter payload. |
| `filter_config`, `filter_options` | Filter interpretation options. |
| `structured_filters` or `filters` | Explicit structured filters. |
| `search_date` | Date context for time-sensitive search filters. |
| `limit` | Result limit. |
| `num_candidates` or `numCandidates` | Candidate count before final filtering/ranking. |
| `rerank` | Boolean reranking flag. |
| `include_raw` | Defaults to true. Include raw matching details. |

Response shape:

```json
{
  "template_id": "...",
  "template_name": "...",
  "structured_filters": {},
  "results": []
}
```

## Manage Templates

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/chat/embedding_templates` | List templates for the authenticated user. Accepts `limit` and `offset`. |
| `GET /v1/chat/embedding_status?template_id=...` | Check template status. |
| `POST /v1/chat/delete_embeddings` | Delete all records for a template. |
| `POST /v1/chat/delete_embedding` | Delete specific record IDs from a template. |

## Operational Notes

- Search runs inside the processor API and depends on MongoDB state.
- Template search uses `text-embedding-3-large`. The separate `/v2/external/embeddings` vector endpoint uses `text-embedding-3-small` at 1536 dimensions; its output cannot be mixed into a large-model template index.
- The processor attempts indexed `$vectorSearch`; if unavailable, it loads the matching template records and scores cosine similarity in memory. Verify index support for the deployment before relying on this path for a large corpus.
- Optional reranking uses `OPENAI_RERANK_MODEL` (default `gpt-6-astra`), independently of the selected assistant model.
- Credit usage is returned in `x-credits-charged` and `x-credits-remaining` headers where the route charges credits.
