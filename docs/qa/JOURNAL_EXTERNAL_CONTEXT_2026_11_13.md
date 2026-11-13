# Journal — external context, single delivery batch

Complete the existing Journal with official local announcements, published fruit/vegetable purchase and price indicators, source freshness and captured revisions. Reuse WeeklyContext, provider cache, local SQLite cache, existing store_week/store_events tools and manager notes. No new business entity, model call, paid provider, build or deployment.

## Acceptance

- Existing weather, holidays, national economy and offline notes remain intact.
- External context is opt-in (`x-context-journal: 1`), absent from legacy responses.
- Asnières municipal works and agenda are announced, incomplete city-level sources; no assumed shop impact, closure duration or observed execution. Other municipalities are explicitly unconfigured.
- FranceAgriMer consumption month is separate from edition/capture date. Published kg/household and €/kg remain distinct; no invented spending, household counts, causal effect or daily interpolation.
- Immutable normalized source revisions reuse contextProviderCache; record first capture, not an invented publication date. Historical local views use captured revisions, never today's mutable announcements as yesterday's facts. Preserve history on failure, 304 and offline.
- Compact UI opens details, provenance and prior captured editions without additional AI calls. Copilot receives bounded summaries through store_week; general notes remain store_events.
- No automatic attribution, fitted prediction or correlation from repeated monthly values. Existing retrospective qualification has insufficient stable evidence for a causal/predictive model.

## Explicit limits

Public local sources are not exhaustive. Transport line selection is awaiting owner clarification; authenticated IDFM access is not configured. No fabricated transport feed or zero disruptions. Manager observations can already record actual local effects. No daily task manager, detailed store layout or PA import in this lot. Sources refresh on Journal focus/manual refresh with shared provider TTL/lease; no claim of continuous background monitoring. Server immutable revisions begin at actual first collection; pre-existing research files are not silently promoted to historical production captures.

## Source verification

Read-only probes on 13 November verified the actual FranceAgriMer paragraph
(consumption September 2026), municipal event cards and published works. Test
fixtures retain selected original sections and source URLs live in the adapters.
Parsers reject changed/unknown layouts instead of guessing numbers or dates.
Archives preceding the first application collection remain unavailable; research
PDFs are not backfilled as publication-time facts. The forthcoming PRIM connector
requires a server key and actual line scope; this batch displays that limitation,
without claiming that transport ingestion is live.
