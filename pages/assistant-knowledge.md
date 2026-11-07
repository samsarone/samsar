# Context-aware assistant

The in-product assistant combines page/view context with a reviewed static knowledge corpus. Vidgenie has initial, rendering, review, error and completed-result guidance. Video Studio, Image Studio and Audio Studio have editing-specific guidance. Initial Vidgenie creative prompts contain 8–10 story-focused lines without aspect ratio, duration, camera instructions or cinematic effects.

Retrieval and message composition belong to the assistant processor. Generic model endpoints and requests without supported context retain their existing behavior. Selected model routing, streaming and usage-based billing use the existing path. Retrieved evidence is included in that one completion.

## Deployment

The existing `assistant-query-processor` image uses the `assistant-runtime` Docker target. A network-disabled Node build step produces a read-only TF-IDF/BM25 index from `services/assistant-query-processor/knowledge/snapshot/`. There are no new runtime packages, downloaded weights, vector databases or services. This is local lexical retrieval with common Thai/Japanese workflow aliases, not a neural semantic embedding model.

The CLI and setup wizard build the assistant image before starting/recreating runtime services. Invalid knowledge fails the build. Other image targets and existing database services are unaffected. Audio Studio conversations use the owner-scoped `assistant_workspaces` collection without creating video projects; knowledge is never stored there.

`ASSISTANT_RAG_ENABLED=false` disables retrieval while retaining page guidance. Missing/corrupt knowledge falls back to contextual assistance without retrieved evidence. Checksums protect release consistency; valid indexes are cached until restart. Roll back using the previous assistant image.

## Maintenance

See the [knowledge README](../services/assistant-query-processor/knowledge/README.md) for source authority, refresh commands, evaluation and configuration. Sync reviewed snapshots with source code. Built releases and caches stay out of source synchronization. Deployment embeds the reviewed snapshot automatically; it never crawls documentation at runtime.
