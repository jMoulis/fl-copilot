# M7 — bilan d’une réalisation privée hors plan (PR 258)

Active workstream: **5 — recommendation follow-up**. This increment closes the generic realization-to-review code gap. Formal operational recommendation staleness and full pilot acceptance remain open; code readiness is not delivery or iPhone acceptance.

## Automated acceptance

- Exact owned native realization → local confirmation/Outbox → Mongo synchronization → bounded review, without an accepted decision or a commercial plan. The read changes no task, declaration, decision, official figures or sync stream.
- Expected version and current state are checked before KPI reads. Another owner/store/unknown UUID reveals no declaration. Withdrawal and concurrent version drift block or invalidate the review; synchronized original details are retained.
- Explicit single-product before/during/optional-after windows use the existing deterministic product-period readers and bounded field-event page. Missing data stays unknown; recorded zero and partial days remain distinct. Same reference data must agree across comparisons. No future windows, overlapping periods, duplicate metrics, unknown arguments or unbounded date spans.
- Result validation binds declaration, product, windows, metrics, events and nested source evidence. Mock SDK transport checks capability absence, valid reads, mismatched scope and sanitized unavailable results. Activity shows comparison; numeric evidence renders through existing source links.
- Existing commercial action reviews remain regression-tested. No paid LLM calls, business-database mutations or EAS builds.

Local checks: `pnpm check` passes 1,906 tests (461 environment-dependent cases skipped locally). The disposable transactional Mongo run passes 15 cases across generic-realization and commercial-review suites. Formatting and both exact-head CI events must pass before merge.

## Pending grouped pilot acceptance

1. From a synchronized private realization, ask for a review of the selected product with explicit periods. The assistant should use known details, ask only for missing ones and avoid requiring a plan or acceptance.
2. Check the concise before/during/after table, source links, missing/partial coverage and relevant competing factors. No attribution of a causal uplift or ROI.
3. Ask without an after window or with incomplete real dates. No invented exposure dates or zero for missing data.
4. Withdraw on the original active card and synchronize. The review must not reuse the retired realization as current proof.
5. Confirm source/advice, declared action and observed figures remain distinct. Product selection for a review does not create a saved product/advice association.

Delivery follows PR 257's compatible API/native group. This API-only reader adds no native dependency, data migration or new sync flag. Workstreams: 1 ongoing; 2 code ready; 3 ongoing; 4 ongoing; 5 ongoing; 6 not started; 7 ongoing.
