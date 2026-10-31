# Recorded sales purchase amounts — 31 October 2026

The owner reports that purchase information is still inaccessible after the first Mongo read release. The canonical daily projections already retain Mercalys `VALEUR PRIX ACHAT` as `performance.sales.purchaseValue`; the safe view omitted it. Expose this existing amount as `salesCost`, its independent `salesCostStatus` and the existing pre-filter availability counts in both product and department daily views.

This is a recorded monetary total associated with sales, not a supplier unit tariff or a new daily price snapshot. The dictionary explains that an exploratory mean cost must pair amounts and quantities on the same days and compatible unit; tax semantics are not certified. PARTIAL stays PARTIAL, missing/invalid/unavailable values remain null, actual zero stays zero. No inferred cost from CA minus margin. The same scoped decimal projection, query validator, scalar citations and private trace/replay apply. Official KPI formulas do not change.

The proposed daily catalogue price import is explicitly deferred by the owner. No new import, schema, collection, prompt, tool, provider, write or native change is included.

## Verification

- Real isolated MongoDB: complete purchase/quantity day pairing, separate partial-day amount, stale value masked by UNAVAILABLE, exact decimal sum, scalar narrative evidence, null-only sum and department zero available independently of absent CA.
- Existing Mongo adapter, controlled SDK and fact-context regression suite: **292 tests passed** across four files.
- Full local structure/lint/typecheck/test passed: **4,600 passed / 742 skipped** (Mongo tests run separately above). API build and bundle-import check passed. Exact-head push/PR, merged-master CI and explicit grouped API release remain required.
- No live model request, production business write or paid EAS build. User acceptance of real purchase answers is not inferred from tests.

Seven M7 workstreams remain open as previously tracked: 1/3/4/5/6/7 ongoing; 2 code ready. This advances analytical access within workstream 4 only.
