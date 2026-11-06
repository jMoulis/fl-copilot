# M8 — compact analytical tool transport, 6 November 2026

## Incident and scope

The owner’s ordinary monthly analysis fails on production source `9d520f2` with `COPILOT_AI_OUTPUT_LIMIT`, matching Sentry [FRUITS-ET-LEGUMES-API-A](https://moulis.sentry.io/issues/159143550/). Five expert steps report 290,803 input tokens and 5,109 output tokens; the last step consumes the unchanged 4,000-output-token ceiling. The router adds 451 input / 34 output tokens. Cached input and reasoning are included subsets. END marks usage incomplete, so these observed STEP totals are not an exhaustive bill. Tool names were not recorded, so the incident does not establish which individual tool produced the largest payload.

## Correction

Reuse the SDK’s `toModelOutput` adapter for analytics_query, analytics_period and Mongo tools. Keep the original validated execution result and canonical evidence unchanged for source links, rendering, fact digests, recommendation freshness, charts and storage. Only the model-facing analytical evidence becomes a named-column table with exact source/detail dictionaries. All rows, precision, coverage, units, nulls, zeroes, pagination and additional fields are preserved; no truncation or sampled totals.

Each evidence row exposes a short generation-local reference alongside its canonical ID. The expert uses these short references in its structured answer. Restore canonical IDs in both partial and final outputs before the existing grounding checks; never persist short references. Unknown references are still rejected, and future canonical-ID collisions fail closed. Ref allocation only commits after the existing size and evidence-conflict checks. Cached results still count against the input budget. Business tools and their execution shape retain existing behavior.

The current query contracts already select period, metrics, products, grouping and page size. No new detail parameter, domain model, database collection, API contract, dependency, model call or larger token/read budget is needed. Add content-free tool family, before/after bytes, evidence count and remaining read count to the existing usage callback, plus allowlisted actual tool names on STEP. No query, pipeline, business values, prompt or provider body is logged.

## Validation

The workload fixture uses twenty products, thirty-one current and thirty-one comparable reference dates, sales/margin/waste, categories, mixed product units, one missing quantity day, quantity/weighted-price evidence and a chart. It runs real deterministic analytical readers, schemas, SDK tool execution, source validation and answer rendering; only database transport and model transport are simulated. Both streaming and non-streaming complete four authorized reads in three model steps with the output limit fixed at 4,000. Streaming partials already contain canonical references; forged refs fail grounding. Full evidence hashes and chart payloads remain unchanged.

Measured fixture payloads: 333,203 → 174,221 bytes across four results (47.7% smaller); the 96-reference final fact list is 13,232 → 2,007 bytes (84.8% smaller). These are serialized bytes on a controlled fixture, **not real provider token savings or proof that production monthly analysis now completes**. No paid synthetic request was made. The fixture uses a 256,000-byte local test budget; production configuration remains unchanged.

349 tests across eight focused suites pass, zero skips. Workspace strict typecheck passes in all ten projects. Workspace lint, changed-file formatting and API build/import also pass. Full exact-head CI and delivery remain separate gates before merge/release.

## Acceptance and boundaries

Build39 stays compatible; this increment is API-only. After delivery, inspect one ordinary owner monthly analysis for successful completion, actual STEP token usage, per-tool size diagnostics, source/chart grounding and answer usefulness. Do not claim a cost reduction from byte counts alone. Preserve source `9d520f2` and its deployment for rollback. Production acceptance and wider M8 gates remain open.
