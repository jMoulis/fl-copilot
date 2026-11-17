# Journal — monthly produce price context

Owner approves adding fruit/vegetable national price context on 16 November.
Reuse the existing INSEE collector, contextProviderCache, daily Journal snapshots,
monthly summaries, native economic sheet and compact Copilot evidence.

## Official source and scope

Verified live INSEE SDMX response, captured on 16 November 2026:
`https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001587668+011813720+011814957+011815032?startPeriod=2025-08&endPeriod=2026-11`.
Raw response retained in `scripts/fixtures/insee-produce-monthly-2026-11-16.xml`.

- [011814957](https://www.insee.fr/fr/statistiques/serie/011814957): monthly IPC,
  base 2025, metropolitan France, COICOP 01.1.6, fruit and nuts.
- [011815032](https://www.insee.fr/fr/statistiques/serie/011815032): monthly IPC,
  same base/geography, COICOP 01.1.7, vegetables, tubers, plantains/cooking bananas
  and pulses.

These are broader categories than the fresh department. No synthetic fresh-only
aggregate, basket weighting, price per kilogram, daily series or causal estimate
is created. The actual capture includes October 2026 for both new series; it is
not evidence of what was published on any earlier store day. Existing revised
vintage, timestamps and historical-publication qualification remain intact.

Each price index uses exactly its own month and the same month one year earlier.
Different last available months remain separate. Missing/invalid price values are
not zero; confidence still reports point differences, not inflation percentages.

## Compatibility and delivery

The new schema accepts retained two-series contexts and both canonical source
URLs. New native requests announce `x-context-produce-prices: 1` beside the
existing economic capability. Older servers ignore the added header and return
the original context. The new API projects both GET and POST responses to the
original series/canonical two-series source URL unless explicitly opted in. This
is a representation of captured values, not a new provider retrieval; the stored
four-series source and capture remain unchanged.

The Copilot reads existing archives and returns only compact monthly facts, their
periods and scope. It does not refresh INSEE per chat, add a tool/model, serialize
all monthly points or change analysis/causality instructions. One bounded public
request covers all four series; the current collection schedule is reused.

Qualification covers real XML metadata, exact arithmetic, old/new route responses,
old-server client compatibility, retained archives, native sheet sources and
compact archive-only Copilot facts. Synthetic deterministic fixture values are
explicit test data, distinct from the real provider capture.

API deployment, public-source collection, merged code, native build availability
and owner acceptance remain separate checkpoints. No paid EAS build is requested.

## 17 November — avoid raw context substitution in conversational answers

Owner test on build 75 exposed a server-side presentation defect: one `value`
marker expanded to the entire mixed economic/local/transit coverage string.
Read-only inspection of assistant message `e1cb0722-f792-4637-ba58-102ac77736bd`
confirmed the persisted answer, rather than a native Markdown rendering failure.

Project the existing deterministic monthly summaries as three citable scalar
facts per series (period, index, annual percentage or monthly confidence points).
Each uses the official individual INSEE series source and retains period, values,
freshness, revision and category qualifications in its source detail. Keep
missing values null. Move the mixed Journal coverage narrative into the existing
evidence detail field, with a short display value. Bound the internal weekly
evidence list to sixteen (four existing plus four series times three fields).
No prompt/model change, new tool, provider request, archive mutation, migration
or native build. Old persisted messages remain intact.

Regression coverage: real reader to answer renderer, two-row Markdown table with
independent source details and no unrelated transport/local/coverage prose in
visible text; exact monthly arithmetic and null values remain tested. Delivery
and a new model-generated answer must be verified separately.

## Delivery and owner acceptance — 17 November 2026: CLOSED

- Feature PR 533 merged at `29a147f81e1e7f63da9fd020f84208fe6335039e`.
- iOS 0.1.0 (75), compiled on the owner's Mac, uploaded and available in the
  existing private owner-only TestFlight group. IPA SHA-256:
  `37c269f414ab9754cb605bab7bf49c714d3cfdd8d6d8fc9ae7f756a5c7927a4f`.
  No paid EAS cloud build was started.
- Server-only correction PR 534 merged at
  `bfe72e377a181ec84f18cdbc1df359efff7e1c67`; final feature head
  `b6f93b3420462ef7f0a452c47484d6cc9e6cf1d5`. Exact push/PR/master checks
  passed: 44029334867 / 44029340083 / 44031294456.
- Live API: `dpl_9yursQsjTFWMPfaJfJ1WCoej6wsZ`, `cdg1`,
  `https://fl-copilot.vercel.app`. READY, public health/database connection and
  unauthenticated private-route rejection verified before/after promotion as
  applicable. Previous API deployment retained:
  `dpl_7jPFLn2V1mYs2Gs1FXtQUxwGbpqw`.
- Local correction verification: 73 focused tests, 18 reader/durable Mongo Journal
  tests (overlapping reader coverage, not an additive distinct-test count), all
  ten workspace typechecks, lint/format/structure and API build passed.
- Owner retest after publication: **« Oui c'est fixé 👍 »**, then agreed lot
  closure. The expected native/Journal/Copilot feature scope is accepted; do not
  request the same recipe again without a new regression. This is not a
  statistical/causal validation of external effects on sales.

No model prompt, new provider call, paid model test, archive rewrite, migration
or new native build accompanied PR 534. Previously sent raw-context messages
remain unchanged. See `../progress/HANDOFF_2026_11_17.md` for continuation.
