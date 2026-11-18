# Journal — national events, approved scope and source qualification

Status: PR 536 merged after exact-head push and PR CI; merged master CI passed.
API published and healthy. Local iPhone build 0.1.0 (76) verified and uploaded to
Apple. TestFlight availability and owner acceptance are not yet confirmed.
Build 75 / PR 534 acceptance remains closed.

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

The checks above preceded delivery. Publication and native delivery are recorded
below; device acceptance remains a separate owner gate.

## Delivery — 17 November 2026

- Feature `e21dcec922317d4f257df9fa86b2d4f7da5dc2da`, PR 536; push
  44145246327 and PR 44145325145 passed. Feature branch deleted.
- Merged source `adb7efb80278a3ebf0e6b36b56444f6ab574ff26`, same tested tree;
  master CI 44147650250 passed.
- API `dpl_2RknNqVV9fa3ajnMemx14sfrjaBS`, READY, production configuration,
  `cdg1`. Staged health 200 / DB connected and private route 401 checked before
  promotion; production alias resolves to this deployment and health passes.
  Retained fallback: `dpl_9yursQsjTFWMPfaJfJ1WCoej6wsZ`.
- Two sandboxed archive uploads failed before deployment creation. The subsequent
  approved upload outside the sandbox succeeded. No protection was disabled.
- Local build **0.1.0 (76)**, clean merged source above. Signature, STORE profile,
  team/bundle, production APNs/API and native news markers verified. SHA-256:
  `1effe0a4bb0ccad53d6bac575ca29eef327f23086ce115466ffdd043df435c30`.
- Apple upload accepted; no public release, tester invitation or EAS submission
  job. Fifteen cloud build IDs are identical before/after; no paid cloud build.
- Two TestFlight status reads hit Apple internal server errors. No replacement
  key or re-upload was attempted; availability is pending read-back.
- Private receipts: workspace `maintenance/journal-national-news-2026-11-17/`.

Focused owner recipe after availability: install build 76, refresh Journal,
open “Actualités et déplacements”, inspect attribution/dates/source link, then
check retained content offline. A source outage or empty selection is explicitly
partial coverage, not proof that no national event occurred. No general M0–M8
retest or paid chat generation is required.

## Owner feedback after delivery

The owner reports “tout fonctionne” after delivery. Functional acceptance is
recorded from this report; the earlier Apple API read failures are not a
remaining delivery blocker. The owner requests a mockup for grouping all
context entries behind a “Repères du jour” page. The owner subsequently approves
implementation on 18 November, with compact weather and the day analysis action
retained in Journal. This separate UX lot is tracked in
`JOURNAL_CONTEXT_PAGE_2026_11_18.md`; accepted national-news functionality stays closed.
