# Journal descriptive association engine

Owner authorizes implementation now, rather than waiting for a longer store
history. Reuse the earlier exploratory Spearman prototype as a shared deterministic
analytics-core function. Integrate one specialized, deferred read capability in
the existing Copilot, not a new agent, background job or model request. Ordinary
bilans keep their current tools and budgets. No native screen/build is required.

## Scope and interpretation

- Explicit closed-day window, 1–93 days. Department canonical daily snapshots or
  one exact current product-family UUID. Family totals reuse the existing
  observed-cohort daily aggregation, including its partial/missing qualification.
- N-1 uses the canonical same ISO week/weekday mapping, including unavailable
  week 53. J−7 is explicit. The shared comparison engine supplies each percentage
  change; no independent monetary formula is introduced.
- Correlate CA/margin percentage changes with paired observed maximum-temperature
  and rainfall differences. Require matching known public/school holiday status,
  AVAILABLE business values, calculable reference and qualified observed weather
  from the same station. Forecasts and unqualified values never substitute.
  Reject pooled weather analysis when station identity changes across the sample.
- Return all four fixed combinations. No search for a best product, lag, station
  or coefficient. Monthly macroeconomic observations remain context, never daily
  independent samples. Current category/family membership is not historical.
- Average ranks preserve decimal ties; only ranks use floating-point arithmetic.
  Missing/constant data yield null coefficients, not zero.
- 21 pairs across four ISO weeks is an explicit reporting policy, **not a
  scientific significance threshold**. Smaller samples retain their coefficient
  when calculable, with INSUFFICIENT_DATA and no qualitative conclusion.
- Leave one ISO week out at a time; return min/max and sign stability, never a
  confidence interval. A sign change/undefined withdrawal is FRAGILE. A stable
  sign yields ASSOCIATION_OBSERVED, not proof of strength, significance or cause.
- The no-recorded-product-event variant removes dates overlapped on either side,
  in Europe/Paris with exclusive event end. It does not establish that remaining
  days had no incidents. Prices, promotions, unrecorded stockouts, traffic,
  assortment and exposure remain uncontrolled; no fitted adjustment, predicted
  gain or causal attribution is produced. Free-text notes are not statistical
  covariates. J−7 samples can overlap; adjacent days/weeks are dependent.

## Architecture, source and bounds

Reuse departmentDailyPerformance, productDailyPerformance, products,
storeProductEvents and WeekContextService.readStored. No direct provider read,
live fallback, original rewrite, KPI mutation, new collection, migration, endpoint
or Outbox command. Current authority is checked before and after the read in the
canonical turn route; every loaded snapshot/source is revalidated for store,
dates, family and identity. Settings fingerprints must match across week reads.

Bounded at 93 dates/186 snapshots (department), 100,000 product-day rows, 10,000
current family products and 1,000 recorded event intervals; limit refusal returns
no sampled coefficient. At most 30 distinct weeks, four stored reads concurrently.
Historical Journal gaps stay unknown. Production cannot silently consume the
local research files as collected store history.

Five canonical evidence records retain study scope and complete per-series
diagnostics. Their digest binds query/store, snapshot input revisions, current
family cohort, source projections and date pairs. Existing citation/model-output
transport is reused. This is retrospective use of currently retained/revised
sources, not proof of what was known at the historical decision date.

## Qualification and delivery

Tests cover known/tied/large-decimal ranks, constant series, fragile week influence,
disjoint exclusions, sample limits, exact ISO comparisons, missing archive without
network fallback, actual retained Mongo archive projection, foreign tenant/source,
partial/zero reference, suspect weather, mixed stations, Paris event boundaries,
family aggregation and citation replay. SDK-boundary tests verify controlled
invocation, mismatched query rejection and deferred loading. Provider test
transport and all seeded study records are controlled local fixtures, not real
production analyses or paid AI calls.

Exact-head CI, merge/API delivery and a real owner study remain separate evidence.
An insufficient real sample is an expected useful result, not permission to
backfill or loosen statistical qualification. No paid native build is needed.

Local qualification: **302 tests pass in five suites, zero skipped**, including
the new study and existing analytical-query tests on an isolated local Mongo
replica set. Ten workspace typechecks, lint, formatting, structure and the API
bundle/import pass. No production business mutation or paid AI call was used.

## Delivery and functional owner acceptance — 14 November

PR 519 is merged and the compatible API is published from
`9429f2b42951e7ec1be8752e265d53254095939f`, deployment
`dpl_KiWNdGX58nmntFRfntKDTpwtMX63`, in `cdg1`. Both exact-head checks and the
master check pass (6,211 tests passed, six skipped). Public health/database,
unauthenticated history/bootstrap refusal and Inngest registration are verified.
The merged branch is removed. No new native build was needed; build 60 suffices.

The owner supplies the real study reply: 42 requested dates, two usable pairs
across one week; 38 calendar exclusions then two weather exclusions, with no
additional business-data exclusions. All four coefficients and weekly sensitivity
are unavailable. The owner considers this normal, agrees to closure and then
confirms. Record **functional study invocation/reporting accepted**, not an
independently reread production trace or evidence of a useful/stable association
on a sufficient historical sample. That empirical assessment remains future work.
