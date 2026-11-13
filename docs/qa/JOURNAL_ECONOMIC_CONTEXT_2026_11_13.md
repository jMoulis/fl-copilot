# Journal — first economic-context increment

Continue the approved contextual Journal after the owner's positive feedback on
build 53's carnet design. Add monthly national INSEE food-price and household
confidence context to the existing Journal/context path and Copilot week reader.
The broader contextual journal, historical observed weather, local events and
fruit/vegetable expenditure series remain separate work.

## Data and interpretation

- INSEE series **011813720**: metropolitan-France food CPI, base 2025 = 100.
  Annual change is calculated in shared analytics-core with BusinessDecimal from
  exactly the same month a year earlier. A missing reference does not become 0%.
- INSEE series **001587668**: metropolitan-France household confidence, seasonally
  adjusted, long-run mean 100. Changes use index points, not a percentage of
  customers or daily store sentiment.
- Fetch a bounded range (15 months before the requested week's first month
  through its last month, capped at the current month). This covers an annual
  comparison even when the latest published month lags the date being viewed.
- Each series keeps its own actual period, source status, revision marker and
  series update date. Missing/confidential values remain null; valid zero remains
  zero. No later month is selected for a past month.
- These are current revised series, not archived publication vintages. The series
  update date is not fabricated as the publication date of every observation.
  Retrospective use does not claim what was known on the historical date.
- No daily economic correlation, causal contribution, store uplift or predictive
  model is derived from these two national monthly series.

## Reused architecture and compatibility

Reuse `contextProviderCache` and `weekly_context_cache`. No business collection,
SQLite migration, Outbox command, cron or new AI agent is added. A single fixed
public SDMX request supplies both series; a shared lease and one-day TTL limit
fetches. Supplier failure/304 retains normalized last-known data and provenance.

The existing provider reader gains an optional response decoder; its JSON
behavior stays the default. The API declares the existing locked XML parser as
a direct dependency, verifies SDMX identity/units/base and bounds the response.
Malformed XML, entities/DTD, duplicates and invalid values fail closed to the
existing cache fallback, independently of weather/calendar/business data.

`GET /api/v1/store/context` exposes optional `economy` only with
`x-context-economy: 1`. Authentication/store authorization still happen first.
Older clients retain their existing response; newer clients accept older APIs.
The local cache preserves economic data if another context reader omits it.

Copilot reuses **store_week**, requests the source on demand and adds one compact
monthly summary to its existing coverage fact. Its four-fact envelope and legacy
context shape stay intact; it does not receive the full monthly arrays. The
source URL, actual months, freshness, units and interpretation boundaries remain.
No prompt for a particular example and no additional model call are introduced.

## Presentation

A compact “Contexte national” row follows observations/history; the detail sheet
shows the two indicators, their separate months and official INSEE links. This
extends the approved Journal layout using existing controls. A provider outage
never hides the product observations or changes the official store KPIs.

## Verification and delivery boundary

The public SDMX response fetched on 13 November is a parser fixture, never seeded
as store/business data. Unit/component tests cover the actual provider format,
exact month references, missing/zero, invalid XML/units, revision, optional older
contracts, period/units/source presentation and SQLite persistence/fallback.
The transactional-Mongo cache test qualifies shared reads, TTL, outage backoff,
304 renewal and absence of business-plan writes.

Local verification: 5,175 tests pass; 868 conditional external/native cases are
skipped locally. Workspace types/lint, frozen-lockfile validation, API build and
iOS export pass. The iPhone 17 Pro simulator confirms the new row and opening of
its real empty/error state, without a business write. The local development API
is unavailable, so populated native end-to-end acceptance is not claimed; period,
value/zero and source-button rendering is covered by mounted component tests.
Exact-head transactional-Mongo GitHub checks remain required before merge.

Record exact-head checks, native visual checks, merge, API delivery and iPhone
availability separately. Build 53 contains only the already-delivered carnet
design; it does not contain this increment. No paid model request is needed for
these deterministic checks.

## Primary references

- https://www.insee.fr/fr/statistiques/serie/011813720
- https://www.insee.fr/fr/statistiques/serie/001587668
- https://www.insee.fr/fr/information/2862759
- https://www.insee.fr/fr/statistiques/fichier/2862759/BDM_serviceweb_SDMX_V2_2_guideutilisation.pdf

The fixture's exact request was
`https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001587668+011813720?startPeriod=2024-01&endPeriod=2026-11`.
Only the bounded selected periods are returned by the application parser.
