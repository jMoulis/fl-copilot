# Journal — national events, approved scope and source qualification

Status: scope approved by owner (“Ok go”) on 17 November 2026. First increment
implemented locally; production activation, exact-head CI/merge and native
release remain pending. Build 75 / PR 534 acceptance is unchanged.

## Approved first increment

National industrial action and exceptional restrictions potentially relevant to
shop access or supply. At most three useful events per day; today and the next
seven days. Sports, elections and general news are outside this first increment.
Use existing Journal collection, cache, immutable revisions, daily archives,
SQLite reading and Copilot readers. No AI collection, additional agent,
orchestration, provider subscription or paid EAS cloud build.

## Real source checks — 17 November

- https://www.cgt.fr/comm-de-presse : HTTP 200 via curl with TLS verification.
  Listing contains article links, short descriptions and publication timestamps
  in HTML time elements. This is an attributed primary source for calls to
  industrial action, not proof of participation or disruption. Coverage is
  incomplete. The November 17 call occurs in multiple publications, demonstrating
  why URL deduplication alone is insufficient.
- https://www.cgt.fr/17-novembre : HTTP 200. Publication label 10 November 2026;
  event day appears in prose/title. The separate press release in the listing
  has a 9 November publication timestamp. Preserve separate source references;
  do not count these as two mobilizations.
- https://www.ecologie.gouv.fr/rss-actualites.xml : HTTP 200, actual RSS with
  title, link, description, pubDate and guid. The current feed mixes relevant
  road restrictions with unrelated policy announcements. National publisher
  does not imply nationwide geographic effect. Example: the A13 announcement
  has publication date 12 November, start 16 November and an approximate end
  (“fin août 2027”). Never normalize that to a fabricated exact end date.

Python urllib could not verify certificates in its local default trust store;
curl succeeded with normal verification. No certificate verification was disabled
and no system trust/toolchain configuration was modified.

## Implementation and limits

1. Extend shared contracts before adapters: stable event/source identity,
   attributed category, original publication/update dates, effective period and
   original date label, capture dates and revision. Source URL is the stable
   source identity. Geographic applicability remains an explicit qualification;
   cancellation/update text stays attributed source text, not an inferred shop
   status. Unknown dates remain unknown.
2. Preserve build 75 compatibility through capability-based projection. Its
   strict journal schema only accepts three known source kinds and does not
   accept new fields. Existing historical cache entries must remain readable.
3. Filter source content conservatively. An unqualified candidate must not
   become an applicable shop event. Do not extract dates from arbitrary first
   date occurrences, assume an event year from a publication year, or infer
   cancellation solely from disappearance from a listing.
4. Reuse existing provider cache and immutable/daily snapshots. Retain revisions
   and source timestamps through outages and cancellation. Past views must not
   silently gain facts collected later. No historical backfill.
5. Deduplicate canonical source URLs (fragments/tracking parameters removed).
   Do not merge different publications based on similar headlines: no reliable
   common event identifier is supplied by these feeds. Cross-publication semantic
   grouping is not claimed. Keep original references and uncertainty.
6. Reuse the three scheduled passes (07:15, 13:15, 20:15 Europe/Paris), shared
   source TTLs, existing bounded HTML reader and XML dependency. Bound feed
   entries and article downloads. The Copilot reads archived data only.
7. Native details show source, publication/effect/capture dates, scope and
   freshness; observations at the shop remain separate. Preserve the three-item
   display limit and explicitly partial coverage. No causal sales assertion.

No provider subscription cost identified for the public pages/RSS. Hosting,
storage and adapter maintenance still consume resources. A target of two feed
checks per scheduled pass gives 180 scheduled feed requests per 30 days, before
bounded detail requests, retries and explicit refresh. This is an estimate, not
a measured bill or an enforced quota.

## Required verification before delivery

- Genuine source fixtures: publication versus event dates, incomplete dates,
  irrelevant articles, unknown geography and duplicate announcements.
- Changed/cancelled events, source failure, malformed/oversized XML/HTML,
  bounded requests and no provider calls from Copilot reading.
- Archive idempotency/restart, offline cache retention, historical knowledge
  boundaries and build 75 projection.
- French native states and three-event limit, types/lint/relevant tests.
- Separate code readiness, exact-head CI/merge, API release, local iPhone build,
  TestFlight availability and owner acceptance under RELEASE_PROCESS.md.

## Local verification

- 5,437 tests passed; 897 environment-dependent tests skipped in the general run.
- Nine daily-archive integration tests passed against isolated local MongoDB 6.0.1
  on loopback, including national source retention through outages.
- Strict TypeScript across all ten packages passed; lint and API bundle/import
  passed. Focused tests also exercise API capability projection, source failures,
  uncertain dates, native link errors, SQLite restart and three news citations
  alongside all four economic series (internal evidence bound increased to 19).
- Read-only real-source parsing returned one social announcement and one road
  restriction. No production context write or source activation occurred.
- Existing Node 24.14.0 ARM64 was selected via process PATH for verification;
  no system toolchain change. The default shell Node 18/x64 was incompatible
  with the existing ARM64 development binaries.

Undated publications are offered as recent reading for 14 days after publication;
this is an editorial retention window, not an invented event duration. Full dated
single-day social headlines may be assigned a date; restrictions with prose or
approximate dates retain unknown structured dates and their original text. Day
views show the selected day plus seven upcoming days (past day views stay on that
day). The Copilot reads the selected week. Neither path injects later captures
into an earlier historical day. Source checks remain bounded to two feed pages
per cache refresh, with no article traversal or model call.

Native component review: bounded rendering, stable URL keys, hooks at component
scope, accessible buttons and errors, existing BottomSheet dismissal and local
context reads. Physical iPhone appearance and gestures are not yet accepted.

No native build, remote deployment, paid provider call or new orchestration was
performed. This is locally verified code, not a published or device-accepted lot.
