# Recommendations

Recommendations use the same embedding templates and semantic-search implementation as search. The recommendation endpoints configure that shared path for reference-item similarity and return compact `{id, score}` matches. This is useful for product recommendations, content similarity, lead matching, related items, and "more like this" flows.

## Docker Services

| Service | Role |
| --- | --- |
| `processor` | Auth, similarity query validation, recommendation matching, credit headers. |
| `mongo` | Embedding templates and source records. |
| Provider | The current embedding/recommendation implementation requires `OPENAI_API_KEY`. |

## Endpoints

```text
POST /v1/chat/similar_to_embedding
POST /v1/chat/similar_to_embeddings
```

Both routes call the same recommendation handler.

## Required Input

| Field | Meaning |
| --- | --- |
| `template_id` | Template created by a search indexing endpoint. |
| `search_term` / `searchTerm` / `query` or `search_json` / `search_record` / `record` | The item, phrase, or structured object to match against the template. |

At least one query signal is required: a text search term or a structured search record.

## Optional Input

| Field | Meaning |
| --- | --- |
| `search_params`, `search_filters`, `filter_payload`, `pre_filter` | Filter payload applied before/around similarity matching. |
| `filter_config`, `filter_options` | Controls how fields are interpreted. |
| `structured_filters` or `filters` | Explicit filters. |
| `search_date` | Date context for filters. |
| `limit` | Maximum matches to return. |
| `min_results` or `minResults` | Minimum desired result count. |
| `num_candidates` or `numCandidates` | Candidate pool before final result selection. |

Response shape:

```json
{
  "template_id": "...",
  "structured_filters": {},
  "matches": []
}
```

## Typical Flow

1. Create a template with `POST /v1/chat/create_embedding` or `POST /v1/chat/generate_embeddings_from_plain_text`.
2. Store the returned `template_id`.
3. Call `POST /v1/chat/similar_to_embeddings` with `template_id` plus a `search_term` or `search_json`.
4. Use `matches` as recommendations.

## How It Differs From Search

| Search | Recommendations |
| --- | --- |
| Uses `search_against_embeddings`. | Uses `similar_to_embeddings`. |
| Requires a text query. | Accepts a text query or structured record. |
| Returns `results`. | Returns `matches`. |
| Supports optional reranking and raw matching details. | Disables LLM reranking and raw details, relaxes strict prefiltering for inferred filters, and returns compact matches. Strict explicit filters can still be vector prefilters; configured soft keys are post-filtered. |

## Provider Availability

The setup wizard lists recommendations under OpenAI and Samsar. The current recommendation route still uses the embedding service, which calls OpenAI embeddings directly. If the route fails in Docker because provider credentials are unavailable, set `OPENAI_API_KEY`, rerun `npm run config:render`, and recreate the processor container.
