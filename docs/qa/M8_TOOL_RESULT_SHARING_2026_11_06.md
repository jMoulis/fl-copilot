# Lossless analytical tool-result sharing — 6 November 2026

## Actual owner retest and scope

The latest owner monthly question produces a stored answer and title in 56 seconds. All observed calls have usage: 120,723 input tokens (60,325 cached, included in input) and 3,088 output tokens including dispatch. Expert-only input is 120,145 and output 3,061. Two product-query results still contain 161 evidence entries each and consume 64,361/65,935 serialized bytes. This is a successful response observation, not full request coverage: global quantity totals remain uncompleted and physical-piece interpretation needs care. A close-listener warning also remains separate. None is silently declared resolved by transport optimization.

## Focused change

Reuse the existing ephemeral analytical model adapter. Share repeated evidence sentences exactly in a local `detailParts` dictionary; each compressed detail keeps its ordered fragment references. Joining fragments reproduces every character, including whitespace, decimals and product-specific caveats. Keep plain details when the dictionary would enlarge the result. For homogeneous query rows, move identical metric-column names to a single query-level header. Heterogeneous/future row shapes retain their fields.

All products, values, nulls, precision, dates, paired-price inputs, coverage, missing-date examples, units, warnings, scope, pagination, chart data and evidence references remain available. No sampling, summary model, extra request, new agent, dependency, configuration, budget increase, database schema or native contract. Canonical execution results, hashes, rendering and stored sources are unchanged. Update only the existing transport-format sentence in the instructions; remove its stale suggestion to output a fact list, already superseded by direct references.

## Evidence and limits

The exact same captured controlled monthly inputs, chart and partial-quantity case pass through the previous released adapter and the new adapter: **115,352 → 81,122 bytes, a 29.67% reduction**. Product-query output is 56,299 → 37,003; measures/chart output 41,552 → 27,932. No changed fixtures or provider-token claims are used for this comparison. Replayed reads remain counted against the unchanged limits.

**405 tests across ten suites pass, zero skipped**, including real transactional Mongo/SQLite title synchronization, real Mongo analytical chart integration and installed-provider scripted HTTP streaming/non-streaming, truncated answers, exhausted/replayed reads, malformed blocks and chart rendering. At the provider boundary, reconstruct and compare every evidence field/detail, row, metadata field and reference with the canonical projected result, not merely the small selection used in the scripted answer. A specific prose-sharing test fails against the previous adapter. Strict types across ten packages, lint and API bundle/build/import pass. Full exact-head CI remains a separate gate.

No paid model request or production business-data mutation is made. Byte reduction is measured; actual token savings and live-model answer quality require an owner retest after API delivery. Build39 stays compatible; no EAS build is needed. Broader M8 remains open.
