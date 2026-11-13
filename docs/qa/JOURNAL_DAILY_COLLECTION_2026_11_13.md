# Daily Journal collection

Owner request: keep a daily external context memory independent of opening the
app, then let the Copilot search stored contexts instead of refreshing providers.

## Implementation

- Existing Inngest signed service: 07:15, 13:15 and 20:15 Europe/Paris. Separate
  per-store workers, concurrency 2 globally/1 per store, two retries. Store listing
  is paginated; scheduler checkpoints carry identities/counts only.
- Existing public readers and shared TTLs. The previous/current/next ISO week are
  consolidated so delayed observed weather and next-week preparation stay useful.
- One retained entry per actual capture day and store/geographic-selection scope,
  containing source-qualified week projections. Underlying original public-source
  revisions retain message history. Intraday transit history remains bounded and
  explicitly partial; three samples do not record every transient incident.
- A new shared validation schema for internal archive records, using only the
  existing collection/indexes. Unique keys, optimistic compare-and-set, real
  first/last capture times; no TTL on daily records. No operational data writes.
- Outages keep prior source values as stale; a monthly value remains monthly and
  weather forecasts never become observed weather. Late observed publications
  keep their real source retrieval timestamps, not a fabricated historical vintage.
- Existing context route prefers saved data (live screen fallback only if absent),
  preserving opt-in projection. Copilot uses the database-only reader, including
  when the archive is absent; there is no provider fetch or automatic web/model
  call to fill a gap during an AI turn. Historical local content remains constrained
  by original source capture dates and application periods.

## Verification

Domain and API tests cover Paris capture-day boundaries, forecast/observation
separation, source-period retention, independent outages, revised measurements,
unchanged settings versions, geographic/store scope and zero provider calls in
repeated Copilot reads. Real isolated Mongo tests cover three-window collection,
daily idempotency, intraday consolidation, restart reads, opt-in legacy payloads,
concurrent first capture and rejecting a changed-location collection.

Local verification: 26 targeted tests pass, including the isolated real Mongo
archive/restart/concurrency suite. Full local checks pass: 5,270 tests passed,
881 environment-dependent skips; strict types, lint, formatting and API bundle
build pass. Exact-head GitHub checks run the transactional Mongo suites before
merge; their results remain the merge gate.

## Delivery boundaries

Not deployed or registered during development. No live collection or PRIM
subscription/authentication success is claimed; existing provider fixtures are
controlled. No iPhone build, paid AI request, provider/key change or production
business write. Activation requires the grouped API release and Inngest function
registration, then a real scheduled run and inspection of its timestamps/statuses.
If Inngest is paused or out of quota, collection does not run; saved data remains
readable and source freshness remains visible. No continuous traffic monitoring,
complete local/news/political feed, causal model or backup qualification is added.

Schedule reference: https://www.inngest.com/docs/reference/typescript/functions/triggers
