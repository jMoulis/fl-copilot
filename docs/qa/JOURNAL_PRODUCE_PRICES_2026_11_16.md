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
