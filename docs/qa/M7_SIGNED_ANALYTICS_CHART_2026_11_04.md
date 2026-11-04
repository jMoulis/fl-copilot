# M7 — signed analytical chart, 4 November 2026

## Defect and bounded implementation

ExplorerTrendChart is shared by Analyses and product performance. It previously scaled absolute magnitudes upward from the bottom; a negative amount differed only in color. Two mounted regression cases (mixed signs and negatives only) reproduce the wrong side of zero before correction; positive-only and zero cases already pass.

Keep the existing canonical buckets and decimal amounts. Drawing uses maximum positive plus maximum negative magnitude for one proportional extent; the same visible zero baseline applies to every column. Negatives extend below it, positives above. Keep the existing two-point minimum mark for very small/zero values; it is presentation, not a changed amount. Missing values draw only the dashed placeholder. A fixed zero marker stays visible beside horizontal scrolling. Column top alignment keeps baselines aligned even when lower labels grow. Existing French full-date/amount/partial accessibility labels, clipping/aggregation, scoped drill and saved-scroll callbacks remain. No business formula, schema, provider, dependency, source publication or write path changes.

## Evidence and boundaries

**30 tests across five files pass, zero skips**, including seven shared-chart cases, existing Explorer scope/context cases and chat-chart/source cases. Geometry checks cover mixed, negative-only, positive-only and zero inputs, proportional positive/negative heights, one common baseline, marks inside the plot, unknown/partial distinctions and unchanged drill dates. Mobile strict types, targeted lint and formatting pass before merge.

A temporary React Native Web harness outside the repository bundles the actual component with installed dependencies, at 320-point content width. Labelled synthetic inputs show a positive 10 above zero and partial −5 below it; a negative-only chart draws −10 and −5 downward in proportion. Clicking the partial negative column displays `2026-11-03`, matching its accessible full date/amount. The harness neither reads production nor mutates business data. This is a browser component review, not native scroll/VoiceOver/device proof. The Mac remains locked; no simulator acceptance is claimed.

Delivery groups this mobile-only increment with PR 436’s selected chat-chart readability. Both exact-head checks, merged source identity, compatible API and downloaded native artifact identity must be verified before availability. No API redeploy is needed. Phone check after that build: open an existing Analyses chart, drill a day and return; open an existing chat chart and its source, with enlarged text where practical. Negative layout is exercised with synthetic component data; do not fabricate production negative observations just to produce a phone fixture. Build 30 remains the owner-accepted baseline until the new grouped build is tested. Workstreams 1/3/4/5 remain closed, 2/6 deferred, 7 remains open.
