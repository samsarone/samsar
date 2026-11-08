# Express pipeline concurrency

Automatic sessions overlap independent computation and provider waits. Shared
timeline writes and final-render dependency checks remain ordered.

| Work | Scheduling | Required barrier |
| --- | --- | --- |
| AI-video motion prompts | Up to three layer prompts in flight by default | Completed images/audio and the shared camera-transition plan |
| AI-video prompt persistence, retiming and enqueueing | Serial, in original layer order, as prepared prompts become available | Fresh session/layer checks before each commit |
| Lip sync and sound effects | Enqueue lip sync first, then sound effects while lip-sync providers are pending | All base clips and reflow complete; lip-sync audio preparation finished; no layer requiring both derivatives |
| Transcripts and narrator avatar | Align subtitles while the avatar provider is pending | Both derivative stages settled and speech timing stable |
| Frames and final video | Existing joins retained | Derivatives, avatar, subtitle attempt, frame jobs and final-output validation |

Manual step sessions retain their stage boundaries and billing order. Prompt
computation can overlap within the AI-video stage, but does not advance the next
manual step. Legacy layers eligible for both lip sync and sound effects retain
serial derivative execution.

## Correctness and recovery

- Camera planning still sees the full set of final image descriptions. Branched
  planning retains its parent-before-descendant persistence barriers.
- Each prepared video prompt carries the existing scene identity, inference
  settings, camera context, duration selection and billing metadata.
- Prompt commits re-read cancellation/pause/failure and layer completion state.
  Completed or already pending layers are not dispatched again. The bounded
  preparation window is drained after errors or cancellation; no unobserved
  background promises remain.
- Lip-sync setup finishes before sound-effect enqueueing. The media worker still
  processes completions serially; provider jobs can be active concurrently.
- Sound-effect request reuse is scoped to sound-effect operations, including
  legacy jobs for the dedicated sound models. Before missing output falls back,
  the listener checks active requests so a stale layer-array write cannot release
  frames while sound generation is still running.
- Billing settlement retains the lip-sync, sound-effect, avatar, finalization
  order and existing idempotency/fallback handling. A settlement failure still
  blocks later settlement and rendering.
- Required failures still stop the session. Optional lip-sync/sound fallback and
  subtitle failure behavior are retained. Frames cannot start before the avatar
  finishes, even if subtitles were prepared earlier.

Overlapping work may already be in flight when another operation fails or the
user cancels. Existing upstream cancellation behavior is unchanged; bounded
prompt preparation can therefore consume a few model calls that are not used.
Provider concurrency limits and retry/backoff policies are unchanged.

This scheduling relies on the matching media-worker implementation preserving
scene durations when completing lip-sync and sound-effect derivatives. Keep that
worker behavior and its frame-budget checks when deploying the listener.

## Controls

Set these in the **express listener process environment**:

| Variable | Default | Behavior |
| --- | --- | --- |
| `EXPRESS_AI_VIDEO_PROMPT_CONCURRENCY` | `3` | Positive integer, capped at `8`. Set `1` for serial preparation. Invalid values use `3`. |
| `EXPRESS_PIPELINE_PARALLEL_STAGES` | Enabled | `false`, `0` or `off` disables derivative and avatar/transcript overlap. |

Set both concurrency to `1` and parallel stages to `false` to restore sequential
scheduling while retaining the additional correctness guards.

## Regression checks

`npm run test:parallel` runs the offline concurrency tests and related stage,
billing and branching tests. Model/provider shims use deferred completions to
exercise the real listener tick and AI-video preparation code with out-of-order
responses, cancellation, resume, failures, stale flags and rendering joins. They
do not call live providers or spend credits. Canvas dependencies must be installed.

Use `npm run build` and `npm run test:all` for the full listener checks. The storage
tests need permission to listen on localhost. Also run `npm test` in
`samsar_ai_video_layer_generator` and `npm run test:frame-drift` in
`samsar_frames_processor` and `samsar_video_generator`; the media tests require
their native dependencies and FFmpeg.

These tests validate scheduling and media invariants; they do not measure live
provider latency or guarantee visual equivalence from nondeterministic models.

## Remaining sequential work

Starting image-to-video as each image completes requires separating shared camera
planning and whole-array timeline updates from per-layer readiness. Early frame
generation also needs immutable scene timing, subtitles, overlays and transition
dependencies. Those barriers remain until those writes and dependencies can be
isolated and tested independently.
