# Hosted-agent billing verification report

Scope: new fixed-price agent requests in a hosted production deployment. This report is generated from the source pricing and usage calculators with mocked completed assets. It is not a live production transaction audit; these changes have not been deployed by this task.

The follow-up [billing boundary audit](billing-boundary-audit.md) documents post-processing isolation, external/legacy refund hardening, and the expanded regression results.

## Billing contract

- Admission deducts the quoted duration × selected-model rate once. The quote and its stage rates are saved on the session.
- Text and image-list builder requests are saved durably before funding, so restart recovery does not lose prepaid work. Repeated admission with the same session ID preserves the original request.
- Stages record completed work without another wallet debit.
- Failure, pause or cancellation retains completed allocations and returns the remainder. Unsuccessful attempts do not add charges. A fully completed stage retains its stage allocation.
- Resume re-funds only the difference between the quote and the amount already retained. Final settlement charges new completed work without charging the old work twice. Gross debits can exceed the original quote across repeated pauses; gross refunds offset those debits.
- Successful completion reconciles the entire fixed package to delivered duration, including the outro, capped at the original quote. Removed failed scenes therefore reduce the final price. A longer output cannot create an unquoted charge.
- Partial settlements remember completed layer IDs across timeline edits. Late worker results after pause do not debit credits; resume can account for them. Cancelling an already-paused request does not charge late results.
- Credits are rounded up once after summing allocations. Fractional per-stage allocations remain in the receipt so their sum plus the rounding adjustment reconciles exactly.

## Allocation per second

Inference 4; images 2; speech 2; music 2; lip sync 1; sound effects 1; pipeline 4. AI video receives the remaining rate after these 16 credits. Optional narrator avatar adds 4 and CTA adds 1. Native audio is not a separate extra debit.

| Model key | Total | AI video | Other fixed allocation |
| --- | ---: | ---: | ---: |
| RUNWAYML | 30 | 14 | 16 |
| VEO3.1I2V | 60 | 44 | 16 |
| VEO3.1I2VFAST | 36 | 20 | 16 |
| COSMOS3SUPERI2V | 20 | 4 | 16 |
| SEEDANCEI2V | 30 | 14 | 16 |
| SEEDANCE2.0I2V | 40 | 24 | 16 |
| SEEDANCE2.5I2V | 60 | 44 | 16 |
| KLINGIMGTOVID4 | 36 | 20 | 16 |
| KLINGIMGTOVID3PRO | 36 | 20 | 16 |
| KLINGIMGTOVIDTURBO | 36 | 20 | 16 |
| HAPPYHORSEI2V | 36 | 20 | 16 |

Seedance 2.5 Agent/Vidgenie is 60 credits/second; its separate Studio tariff remains 50. Legacy Kling keys preserve the current 36-credit agent allocation.

## 60-second request scenarios

Each cell is **net retained / refunded**. The partial-work fixture has narrative completed for 60 seconds and one 30-second layer completed for images, AI video, speech, lip sync and effects, plus 30 seconds of music. Pipeline rendering is unfinished. Its retained charge happens to equal half the quote; this is not a general “50% on failure” rule.

| Model | Upfront debit | Failed before work | Narrative only | Partial failure or pause | All generative stages done, render fails | Successful 48s output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RUNWAYML | 1800 | 0 / 1800 | 240 / 1560 | 900 / 900 | 1560 / 240 | 1440 / 360 |
| VEO3.1I2V | 3600 | 0 / 3600 | 240 / 3360 | 1800 / 1800 | 3360 / 240 | 2880 / 720 |
| VEO3.1I2VFAST | 2160 | 0 / 2160 | 240 / 1920 | 1080 / 1080 | 1920 / 240 | 1728 / 432 |
| COSMOS3SUPERI2V | 1200 | 0 / 1200 | 240 / 960 | 600 / 600 | 960 / 240 | 960 / 240 |
| SEEDANCEI2V | 1800 | 0 / 1800 | 240 / 1560 | 900 / 900 | 1560 / 240 | 1440 / 360 |
| SEEDANCE2.0I2V | 2400 | 0 / 2400 | 240 / 2160 | 1200 / 1200 | 2160 / 240 | 1920 / 480 |
| SEEDANCE2.5I2V | 3600 | 0 / 3600 | 240 / 3360 | 1800 / 1800 | 3360 / 240 | 2880 / 720 |
| KLINGIMGTOVID4 | 2160 | 0 / 2160 | 240 / 1920 | 1080 / 1080 | 1920 / 240 | 1728 / 432 |
| KLINGIMGTOVID3PRO | 2160 | 0 / 2160 | 240 / 1920 | 1080 / 1080 | 1920 / 240 | 1728 / 432 |
| KLINGIMGTOVIDTURBO | 2160 | 0 / 2160 | 240 / 1920 | 1080 / 1080 | 1920 / 240 | 1728 / 432 |
| HAPPYHORSEI2V | 2160 | 0 / 2160 | 240 / 1920 | 1080 / 1080 | 1920 / 240 | 1728 / 432 |

A complete 60-second output retains exactly the upfront debit and refunds zero.

## Pause, resume and outro scenarios

Resume fixture: the partial pause above is followed by resume and a successful 50-second final output. “Total refunds” includes both the pause refund and final duration refund. Outro fixture: 60 seconds + 8-second outro quoted; delivered 48 seconds + the same 8-second outro = 56 billable seconds.

| Model | Resume: gross debits | Resume: total refunds | Resume: net charge | Outro: upfront (68s) | Outro: final (56s) | Outro: refund |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RUNWAYML | 2700 | 1200 | 1500 | 2040 | 1680 | 360 |
| VEO3.1I2V | 5400 | 2400 | 3000 | 4080 | 3360 | 720 |
| VEO3.1I2VFAST | 3240 | 1440 | 1800 | 2448 | 2016 | 432 |
| COSMOS3SUPERI2V | 1800 | 800 | 1000 | 1360 | 1120 | 240 |
| SEEDANCEI2V | 2700 | 1200 | 1500 | 2040 | 1680 | 360 |
| SEEDANCE2.0I2V | 3600 | 1600 | 2000 | 2720 | 2240 | 480 |
| SEEDANCE2.5I2V | 5400 | 2400 | 3000 | 4080 | 3360 | 720 |
| KLINGIMGTOVID4 | 3240 | 1440 | 1800 | 2448 | 2016 | 432 |
| KLINGIMGTOVID3PRO | 3240 | 1440 | 1800 | 2448 | 2016 | 432 |
| KLINGIMGTOVIDTURBO | 3240 | 1440 | 1800 | 2448 | 2016 | 432 |
| HAPPYHORSEI2V | 3240 | 1440 | 1800 | 2448 | 2016 | 432 |

## Other pricing and compatibility cases

- Avatar + CTA uses the actual preflight allocation: base rate + 5 credits/second. The all-model tests verify both quote and shorter-output refund.
- Reused narrative retains the existing pricing treatment: inference is waived and its allocation moves to pipeline finalization. It is not charged again as a new narrative call.
- Branched requests retain existing unique-layer duration billing. Shared layers and shared outros count once; exported path durations are not added together.
- Standalone edition, adapter/per-call jobs, external requests, and configured custom/provider workflows retain their existing billing path. The new policy does not replace provider billing or alter custom-provider fallback pricing.
- Already charged legacy sessions are not automatically migrated or retrospectively refunded. Their existing receipts can be incomplete after an old wallet/ledger failure; automatic migration could double-charge or over-refund them. New fixed-price requests use billing version 2.
- Clones and joined videos discard inherited settlement state and final duration. Studio editing/reroll billing retains its existing path.

## Failure and concurrency checks

The test suite runs every listed model against complete success, partial failure/pause/cancel, each individual media stage, repeated callbacks, pause/resume cycles, resume then failure, shorter output and outro accounting. It also covers:

- Lost wallet response after a successful debit/refund.
- Ledger or session-receipt failure after money moved, followed by recovery.
- Concurrent admission and settlement calls; durable operation IDs prevent repeated wallet mutations.
- A newer pause racing an unfinished resume; the older request cannot reactivate work.
- Insufficient wallet balance or API-key limit at resume; previously retained usage remains paid and generation remains paused.
- Late worker callbacks and conflicting terminal outcomes; settled requests cannot be funded again.
- Completed assets later removed from the timeline, duplicated media/audio and failed outputs with stale paths.
- Final artifact arriving during pause; resume reuses that artifact before final reconciliation.
- Durable text and image-list builder recovery, including pause before builder start and pause racing admission.
- Mongoose schema persistence, processor/listener module parity, API control routing, clone/join isolation and existing status/orchestration/render regression suites.

The account balance change and its permanent operation marker are one atomic account-document update. A durable pending operation on the session and a deterministic ledger ID allow retries without a cross-document transaction. Permanent markers must not be deleted casually; an archival design must preserve this deduplication guarantee.

## Deployment and verification

Run `npm run test:hosted-agent-billing` in both processor and express-listener source repositories. Generate this report with `npm run report:hosted-agent-billing` in the processor.

Deploy the compatible express listener before enabling new processor admissions; deploy the final-video worker with it so rendered frame duration is persisted. An older listener must not process version-2 prepaid requests, because it would still apply legacy stage debits. Existing version-1 sessions remain on the old path.

Live deployment checks remain to be performed: use dedicated test accounts, capture initial/final wallet balances and ledger totals, and verify one success, one partial failure, one pause/resume and one outro/shorter-output case. No paid provider calls, production balance changes, migrations or deployments were performed to generate this report.


## Recorded verification (2026-11-08)

local source repositories; hosted-production policy mocked; no live billing or paid providers. processor, express listener, video generator and AI-video worker build checks passed.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Processor hosted-agent suite | 296 | 0 | 0 |
| Express listener hosted-agent suite | 234 | 0 | 0 |
| Existing provider/video billing regression suite | 98 | 0 | 0 |
| Final video worker suite | 76 | 0 | 0 |
| AI-video worker suite | 57 | 0 | 0 |

Counts are test executions per suite, with shared cases repeated in both services; they are not a count of unique tests. This dated verification snapshot is separate from regenerating the pricing tables.
