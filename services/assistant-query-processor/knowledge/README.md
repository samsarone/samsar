# Context-aware assistant knowledge

The in-product assistant retrieves from a reviewed static corpus before the existing completion call. The message builder owns retrieval and page prompts; the queue listener owns claiming, streaming and billing. Generic inference/model endpoints and legacy requests without supported page context keep their existing behavior.

## Local storage and retrieval

`snapshot/` contains 228 reviewed documents, 1,833 chunks and 81 sources: Samsar docs, monorepo README/guides, reviewed public blog summaries and source analysis restricted to current projects in the production source manifest. Code facts record evidence hashes. Historical blog claims and operator-only material are excluded from user-facing retrieval.

`node knowledge/index.mjs build` produces an immutable `release/`: text corpus, provenance, checksum manifest and `index.json` containing normalized sparse TF-IDF vectors, vocabulary, frequencies and term counts. Query ranking combines cosine similarity, BM25, source authority and page-title relevance. References are bounded data, never system instructions. The assistant may cite retrieved public documentation URLs.

Building and querying use **only Node built-ins**. There is no SQLite, Mongo/Cosmos knowledge collection, vector service, Python package, downloaded model or embedding API. The unfinished E5/PyTorch prototype was replaced to honor the dependency constraint. These are lexical embeddings, not neural semantic embeddings. Thai/Japanese workflow aliases support common queries but do not provide general multilingual semantic matching; novel paraphrases may require explicit product terms.

The answering model remains the user's selected assistant model. Retrieval adds no separate provider call or charge; evidence tokens are included in normal completion usage and existing billing.

## Context and prompts

The client sends versioned `assistantContext` with an allowlisted page/view, bounded draft, T2V/I2V mode, selection and locale. The API filters it, includes it in idempotency checks and stores it with the queued request. The worker revalidates it and adds a minimal summary of the authorized session. Asset URLs, credentials, whole sessions and arbitrary client model instructions are excluded from this context.

| Page/view | Behavior |
| --- | --- |
| Vidgenie initial | Creative requests receive 8–10 unnumbered story-focused lines. No aspect ratio, duration, camera instructions or cinematic effects. T2V establishes the premise; I2V preserves described reference subjects and continuity. Factual questions retain a normal answer format. |
| Vidgenie rendering/review/error | Stage-aware review and recovery advice without invented progress or automatic actions. |
| Vidgenie complete | Documented post-processing ideas, targeted edits, subtitles, audio and outro guidance. |
| Video Studio | Advice for the selected scene and active editing toolbar. |
| Image Studio | Generation versus edit/mask/layer guidance; visual observations require an attachment. |
| Audio Studio | Generate/join guidance for music, speech and effects, without fabricated listening or unsupported controls. |

Audio Studio lazily opens an owner-scoped conversation through `/assistants/workspace`. Conversation state lives in `assistant_workspaces`, using the same queue, streaming, reset and billing flow. It creates no video project. **This collection contains conversations only, never knowledge documents or vectors.** Media-page conversations retain their existing storage and authorization.

Unsupported/missing context uses the original system prompt. `ASSISTANT_RAG_ENABLED=false` disables retrieval while retaining page guidance. `ASSISTANT_KNOWLEDGE_DIR` selects an optional trusted local release directory. Missing/corrupt knowledge falls back to contextual assistance without retrieved evidence or remote retrieval. Valid releases are cached for the worker lifetime; deploy/restart to change releases. Generic warnings contain no query or source contents.

## Build and deploy

```bash
node knowledge/index.mjs build
node knowledge/index.mjs check
node knowledge/index.mjs query knowledge/release 'How do I join audio clips?'
npm test
python3 -m unittest discover -s knowledge -p 'test_*.py'
```

The assistant Dockerfile and monorepo/production `assistant-runtime` targets build and validate the index with networking disabled. Only the existing assistant image receives the release. Other targets and database services are unaffected. Build failures stop deployment before application recreation. Docker caching reuses unchanged builds. Production integration changes must be applied to the production checkout before that checkout gains this behavior.

Sync source, reviewed snapshots and build scripts, not built releases, caches or environment files. Roll back with the previous assistant image. Local builds refuse to overwrite a different published release: build into an unused candidate directory, verify it and deploy the directory as a unit.

## Corpus refresh

Refresh the docs export and review `sources/blog.json` and `sources/code-analysis.json`. Changed code evidence requires reviewing its claim and hash. Deployment uses the checked-in snapshot; requests never crawl or analyze source.

```bash
python3 knowledge/corpus.py --workspace /path/to/samsar_one --production /path/to/samsar-production --output /tmp/reviewed-corpus
python3 knowledge/validate_corpus.py --corpus /tmp/reviewed-corpus
node knowledge/index.mjs build /tmp/reviewed-corpus /tmp/assistant-knowledge-candidate
node knowledge/index.mjs check /tmp/assistant-knowledge-candidate
```

After reviewing the differences, replace the tracked snapshot with the reviewed corpus and deploy normally. Python standard-library tooling is only for editorial corpus refreshes; deployment and retrieval do not require it. No scheduled crawler or automatic publication is enabled.

## Verification

Tests cover corpus provenance/scope, real lexical vectors, integrity failures, English/Thai/Japanese workflow queries, page prompts, untrusted metadata, legacy message compatibility, attachments, request-specific history and existing streaming/billing recovery. Provider completions are mocked: instructions cannot guarantee every live model response has exactly 8–10 lines. `evaluation.json` also includes historical-price traps, missing live status and unrelated questions.

Validate a deployed artifact with `node /app/knowledge/verify_artifact.mjs` inside the assistant container. No live model inference is needed for this check.
