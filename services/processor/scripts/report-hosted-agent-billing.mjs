import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildHostedAgentQuote, calculateHostedAgentUsage } from '../src/billing/HostedAgentUsage.js';
import { estimateExpressVideoCreditsForPreflight } from '../src/models/ExpressVideoStageBilling.js';
import { EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL, getAgentVideoCreditsPerSecond } from '../src/consts/pricing/ExpressVideoPricingDistribution.js';

const models = Object.keys(EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL);
const quote = (model, durationSeconds = 60, addons = false) => buildHostedAgentQuote(estimateExpressVideoCreditsForPreflight({
  durationSeconds, videoModel: model, pricingRateClass: 'agent', expressCtaGeneration: addons, addNarratorAvatar: addons,
}), { model });
const partial = q => ({ hostedAgentBilling: { quote: q }, expressGenerationStatus: { prompt_generation: 'COMPLETED' },
  layers: [{ _id: 'a', duration: 30, durationOffset: 0,
    imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'a.png' },
    aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'a.mp4',
    lipSyncVideoGenerationStatus: 'COMPLETED', lipSyncVideoLayer: 'a-lip.mp4',
    soundEffectVideoGenerationStatus: 'COMPLETED', soundEffectVideoLayer: 'a-sfx.mp4' },
    { _id: 'b', duration: 30, durationOffset: 30 }],
  audioLayers: [{ _id: 'speech', generationType: 'speech', connectedLayerId: 'a', generationStatus: 'COMPLETED', selectedLocalAudioLink: 'speech.wav' },
    { _id: 'music', generationType: 'music', duration: 30, generationStatus: 'COMPLETED', selectedLocalAudioLink: 'music.wav' }],
});
const lines = [`# Hosted-agent billing verification report

Scope: new fixed-price agent requests in a hosted production deployment. This report is generated from the source pricing and usage calculators with mocked completed assets. It is not a live production transaction audit; these changes have not been deployed by this task.

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
| --- | ---: | ---: | ---: |`];
for (const model of models) { const q = quote(model); assert.equal(q.rate, getAgentVideoCreditsPerSecond(model)); lines.push(`| ${model} | ${q.rate} | ${q.rates.ai_video_generation} | 16 |`); }
lines.push(`
Seedance 2.5 Agent/Vidgenie is 60 credits/second; its separate Studio tariff remains 50. Legacy Kling keys preserve the current 36-credit agent allocation.

## 60-second request scenarios

Each cell is **net retained / refunded**. The partial-work fixture has narrative completed for 60 seconds and one 30-second layer completed for images, AI video, speech, lip sync and effects, plus 30 seconds of music. Pipeline rendering is unfinished. Its retained charge happens to equal half the quote; this is not a general “50% on failure” rule.

| Model | Upfront debit | Failed before work | Narrative only | Partial failure or pause | All generative stages done, render fails | Successful 48s output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const model of models) {
  const q = quote(model);
  const state = partial(q);
  const empty = calculateHostedAgentUsage({ hostedAgentBilling: { quote: q } }, 'FAILED').totalCharged;
  const narrative = calculateHostedAgentUsage({ hostedAgentBilling: { quote: q }, expressGenerationStatus: { prompt_generation: 'COMPLETED' } }, 'FAILED').totalCharged;
  const part = calculateHostedAgentUsage(state, 'PAUSED').totalCharged;
  const all = calculateHostedAgentUsage({ hostedAgentBilling: { quote: q, completedStages: Object.fromEntries(Object.keys(q.rates).filter(s => s !== 'pipeline').map(s => [s, true])) } }, 'FAILED').totalCharged;
  const short = calculateHostedAgentUsage({ hostedAgentBilling: { quote: q }, finalVideoDurationSeconds: 48 }, 'COMPLETED').totalCharged;
  assert.equal(part, 30 * q.rate); assert.equal(all, 60 * (q.rate - 4)); assert.equal(short, 48 * q.rate);
  const pair = n => `${n} / ${q.credits - n}`;
  lines.push(`| ${model} | ${q.credits} | ${pair(empty)} | ${pair(narrative)} | ${pair(part)} | ${pair(all)} | ${pair(short)} |`);
}
lines.push(`
A complete 60-second output retains exactly the upfront debit and refunds zero.

## Pause, resume and outro scenarios

Resume fixture: the partial pause above is followed by resume and a successful 50-second final output. “Total refunds” includes both the pause refund and final duration refund. Outro fixture: 60 seconds + 8-second outro quoted; delivered 48 seconds + the same 8-second outro = 56 billable seconds.

| Model | Resume: gross debits | Resume: total refunds | Resume: net charge | Outro: upfront (68s) | Outro: final (56s) | Outro: refund |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const model of models) {
  const q = quote(model); const part = calculateHostedAgentUsage(partial(q), 'PAUSED').totalCharged;
  const final = calculateHostedAgentUsage({ hostedAgentBilling: { quote: q }, finalVideoDurationSeconds: 50 }, 'COMPLETED').totalCharged;
  const debits = q.credits + q.credits - part; const refunds = debits - final;
  const outro = quote(model, 68); const delivered = calculateHostedAgentUsage({ hostedAgentBilling: { quote: outro }, finalVideoDurationSeconds: 56 }, 'COMPLETED').totalCharged;
  assert.equal(debits - refunds, final); assert.equal(outro.credits - delivered, 12 * q.rate);
  lines.push(`| ${model} | ${debits} | ${refunds} | ${final} | ${outro.credits} | ${delivered} | ${outro.credits - delivered} |`);
}
lines.push(`
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

Run \`npm run test:hosted-agent-billing\` in both processor and express-listener source repositories. Generate this report with \`npm run report:hosted-agent-billing\` in the processor.

Deploy the compatible express listener before enabling new processor admissions; deploy the final-video worker with it so rendered frame duration is persisted. An older listener must not process version-2 prepaid requests, because it would still apply legacy stage debits. Existing version-1 sessions remain on the old path.

Live deployment checks remain to be performed: use dedicated test accounts, capture initial/final wallet balances and ledger totals, and verify one success, one partial failure, one pause/resume and one outro/shorter-output case. No paid provider calls, production balance changes, migrations or deployments were performed to generate this report.
`);
const validation = JSON.parse(readFileSync(new URL('../docs/hosted-agent-billing-validation.json', import.meta.url), 'utf8'));
lines.push(`\n## Recorded verification (${validation.verifiedOn})\n\n${validation.environment}. ${validation.builds}.\n\n| Suite | Passed | Failed | Skipped |\n| --- | ---: | ---: | ---: |`);
for (const run of validation.suites) lines.push(`| ${run.suite} | ${run.pass} | ${run.fail} | ${run.skipped} |`);
lines.push('\nCounts are test executions per suite, with shared cases repeated in both services; they are not a count of unique tests. This dated verification snapshot is separate from regenerating the pricing tables.');
console.log(lines.join('\n'));
