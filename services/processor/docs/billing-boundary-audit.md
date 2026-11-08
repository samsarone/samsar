# Post-processing billing and refund isolation

Validated locally on 2026-11-08. This is a source and mock-test report, not an audit of production transactions. No deployment, production refunds, or historical data migration was performed.

## Billing ownership

Every newly created post-processing session receives a destination-owned billing record before work becomes runnable. The record identifies the session, owner, operation, price, charging mode, amount charged, and refund ceiling. Fixed-fee debits use a permanent idempotency key tied to the destination session.

Copies omit the original agent quota, pending wallet operations, provisional balance, paid-stage allocations, receipts, refund records, external-request identity, and delivered-duration measurement. Omitting these fields from the copy write also preserves the destination's new admission record and any external-request linkage already saved by another handler. Source sessions and reused media are not mutated by the billing reset.

Starting a full new agent job from a post-processing result creates a fresh billable session; it cannot run under the post-processing fee or overwrite that session.

Agent funding and settlement reject a billing record bound to another session or user. Historical unbound v2 funding requires a wallet marker proving that this particular session was funded. Post-processing requests do not enter agent allocation billing, including when an old copied quota is still present.

## Existing prices and policy

| Operation | Separate charging policy |
| --- | --- |
| Translate/retranslate | 3 credits × rounded-up billable duration in seconds |
| Join | 3 credits × rounded-up joined billable duration in seconds |
| Add/update outro | 75 credits |
| Update/remove footer | 75 credits |
| Add/remove subtitles; ordinary copy/render | No new fixed fee |
| Layer reroll | Newly completed image/video calls use their existing adapter billing |

Fixed post-processing fees retain their existing upfront charging policy. This change does not introduce agent-style allocation refunds for those fees. It removes accidental inherited agent charges/refunds. Reroll completion receipts report actual model debits attributed to the new session. Externally billed requests keep their separate ExternalUserRequest reservation/refund policy; their local session has no internal-wallet refund entitlement for that external reservation.

## Refund protections

- Both external refund entry points share one cumulative refund target and ceiling per request. Repeated requests for a 20-credit refund do not represent additional 20-credit increments.
- A durable pending operation is saved before any wallet mutation. Wallet changes and permanent operation markers are atomic on each account document. Ledger entries have deterministic identities.
- Parent wallets, finite customer allocations, and external balances/mirrors are protected separately. Recovery can finish the remaining writes without repeating completed credits.
- Allocation refunds are limited to the allocation actually charged. An originally unlimited allocation does not receive a new credit merely because it later becomes finite.
- External refund ownership is captured with the charge; profile metadata cannot redirect the refund.
- Legacy provisional failures choose one settlement route. An internal-mapped external request uses external settlement, which already restores the parent wallet; it is not also refunded directly.
- Agent and post-processing records are excluded from the legacy provisional helper.
- Delivery callbacks no longer contain an alternate external-wallet refund implementation or overwrite refund totals.
- The processor recovers persisted pending external/legacy refunds on startup and periodically, with independent failures rotated so they do not starve other requests. Recovery does not initiate provider work.

For older external requests whose helpers disagreed about gross/net receipt amounts, refund initialization prefers actual debit/credit ledger evidence. When that evidence is missing, the recorded charge is a conservative ceiling; the code does not invent additional funding. Historical incorrect transactions are not reversed automatically.

## Reproductions now covered

| Scenario | Expected verified result |
| --- | --- |
| Copy a funded 3,600-credit agent quota and fail both sessions | Copied quota cannot refund; only the original can settle its own funding |
| Start a 75-credit post-processing request from that source | Separate 75-credit debit/receipt; no inherited 3,600-credit entitlement |
| Two or more callbacks refund one 20-credit external charge | Total wallet refund is 20 |
| Refund targets 5, then 10, then 10 again, then 2,000 against a 20-credit charge | Cumulative refunds are 5, 10, 10, then 20 |
| Wallet update succeeds but response, ledger, or receipt fails | Retry/recovery repairs bookkeeping without another credit |
| Parent refund succeeds before allocation/mirror update fails | Retry restores only unfinished writes |
| Legacy provisional failure and external failure happen together | Same original charge is refunded once |
| Acceptance retry races with a refund | Refunded charge and terminal status are not restored by the acceptance callback |
| Final external price drops from 20 to 12 | Own request retains 12 and returns 8; its upstream identity remains attached |
| Unfunded request or free operation | No positive refund entitlement |

## Validation

The new isolation matrix covers every model key in the fixed-agent pricing registry, plus active, paused, and completed source quotas. Existing agent tests retain the success, failure, pause/resume, shortened-output/outro, retry, and ledger-failure matrices.

Passing suites (counts overlap; do not add them as unique tests):

| Suite | Passing tests |
| --- | ---: |
| Processor hosted-agent billing | 334 |
| Listener hosted-agent billing and status/queue integration | 281 |
| Processor billing boundaries/post-processing | 118 |
| Processor credit/security | 119 |
| Processor video billing | 98 |
| Processor image billing | 69 |
| Processor assistant billing | 137 |
| Processor frame timing | 50 |
| Listener parallel preparation and stage progression | 86 |
| AI-video billing, completion, lip-sync, sound and worker regression selection | 145 |
| Final renderer frame timing | 18 |

Syntax checks and whitespace checks passed. Tests use mock accounts/providers and local media fixtures, not live provider generation or production balances.

Re-run the focused processor suite with `npm run test:billing-boundaries`, and the original agent matrices in both services with `npm run test:hosted-agent-billing`.
