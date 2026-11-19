# Publication generation models

New and republished linear and interactive publications save `imageModel`,
`videoModel`, and `inferenceModel`, plus a `generationModels` snapshot. The
snapshot contains deduplicated `image`, `video`, and `inference` model lists so
videos made with multiple models retain their attribution. The singular fields
contain the first model in the corresponding list for existing consumers.

Attribution comes from persisted generation records for selected assets, explicit
layer model fields, and stored source-session generation settings. Publication
request model hints and current account defaults do not determine attribution.
Historical model identifiers are preserved, including retired identifiers.

Each category has an `evidence` value:

- `generated-asset`: a selected asset matched a saved generation record.
- `layer`: an explicit model identifier was saved on a layer.
- `session`: only the source session's generation settings were available.
- `publication`: the backfill preserved existing publication attribution.
- `unavailable`: no model identifier was recorded.

Session settings can change after generation, so `session` evidence describes the
best recoverable session value rather than verified asset history. Missing
categories have empty model lists, a null singular field, and an entry in
`generationModels.missing`. Uploaded media and old sessions may lack generation
records. The inference model refers to source-session generation, not the model
that later wrote the publication title or description.

Public feed/detail and publication management responses expose `inferenceModel`
and `generationModels`. Linear management responses also expose
`inference_model` and `generation_models`. The snapshot is stored on the
publication itself; subsequent session deletion does not remove it.

## Deferred production backfill

The backfill is prepared in source. Run it only after the source fix is deployed
and production database work is authorized, inside the processor runtime with
its existing production environment. Do not load workstation `.env` files into
the production runtime.

The generated image and AI video schemas declare `{ sessionId: 1 }` indexes for
selected-asset attribution queries. During the later deployment, verify those
indexes exist in both collections before the backfill; account for any required
index build before scanning publication history. Source edits and local tests do
not create indexes or connect to the production database.

First inspect the report without making writes:

```sh
node scripts/backfill_publication_generation_models.js --batch-size=200
```

Then apply the same backfill when authorized:

```sh
node scripts/backfill_publication_generation_models.js --apply --batch-size=200
```

The CLI requires `CURRENT_ENV=production`. It processes both publication
collections, preserves existing nonempty attribution, and only fills missing
model fields and snapshots. It reports missing sessions/models and skips staged
interactive republishes. Conditional updates avoid overwriting concurrent
publication changes. Publication content, dates, and timestamps stay unchanged.
Re-running fills remaining holes without replacing saved attribution.
