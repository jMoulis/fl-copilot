# Daily purchase prices — source qualification, 18 November 2026

Owner supplies `base article.xlsx` after requesting daily purchase-price uploads.
This record scopes that next increment; no prices have been published and no
numerical counter-promotion scope is reopened.

## Observed source

- Original retained privately outside Git at
  `maintenance/purchase-prices-2026-11-18/base-article-source.xlsx`.
- SHA-256: `98582cfe93892912a5f5f98b92606b864f9b31a9d191091f452ef883e3dca6a1`.
- `Mercalys` populated; `Feuil2` and `Feuil3` empty. No formulas.
- Store 9083. Export timestamp at A2: 14 November 2026 17:46:30.
  Application date at A5: 14 November 2026. A3 contains `TEST`.
  Use the declared application date, not upload date or file modification time.
- Headers A10:F10: ITM, EAN, LIBELLE, NOMENCLATURE,
  PRIX ACHAT PAR UNITE, ACTIF.
- Rows 11–1236: 1,226 records, matching the declared footer A1239.
  550 FRUITS FRAIS, 620 LEGUMES FRAIS, 56 POMMES DE TERRE.
- 1,176 marked Oui and 50 Non. Preserve this as source status; it must not
  silently deactivate current catalogue products.
- ITM and EAN are both 13-character strings with leading zeros; each column
  has 1,226 unique values and no missing identifier. Preserve exact strings;
  do not truncate ITM into ITM8 without verified mapping. Existing product
  matching uses exact validated identifiers and exposes ambiguity.
- No missing, zero or negative prices. 170 prices equal 0.01 and two equal
  0.001; all 172 rows are marked active. Preserve three-decimal precision.
  Do not silently treat these as missing or reliable calculation inputs before
  owner clarification. Source nomenclature also includes unexpected labels;
  it must not overwrite validated product category/nature automatically.
- No explicit per-row KG/UNIT basis, currency field or HT/TTC field.
  A label mentioning a package weight is not proof of the price denominator.

## Existing implementation and proposed small first lot

The current Mercalys detector supports sales/waste movement reports with flow,
quantity and monetary-value columns. This article-price snapshot is a separate
format, not a compatible sales report. Reuse the local XLSX reader, source-file
retention, Imports entry point, product matching/review and canonical Outbox/sync.

Proposed journey: Imports → Prix d’achat → select workbook → preview store,
application date, matched/unmatched products and price issues → confirm import.
Keep source lines and historical dated price observations; a repeated identical
source must not double-publish. A corrected source on the same application date
needs explicit reconciliation, not additive prices or silent history overwrite.
Do not fabricate prices for absent days or replace official Mercalys margins.
First lot should expose dated price history and coverage, with no AI parsing,
new provider or simulation feature. Domain contract, local migration, server
persistence and incremental synchronization must precede publication code.

## Owner decisions — 18 November 2026

1. Owner confirms purchase amounts are HT, per kg for weight-based articles and
   per sold unit/package for other articles. Resolve that basis from validated
   product units; do not infer it solely from label text or package weight.
2. Owner describes prices of 0.01 and 0.001 as generally belonging to inactive
   products. All 172 corresponding rows in this file nevertheless say ACTIF=Oui.
   This does not authorize changing catalogue status or calling every price false.
3. After that discrepancy was explained, owner explicitly approves keeping these
   exact values as “Prix à vérifier”, excluded from calculations until confirmed.
   Preserve the raw amount and source status. No automatic product deactivation,
   no replacement with zero, no extension to other price thresholds by inference.

The two source interpretation questions are resolved. The first import increment
can use these rules; numerical counter-promotion simulations remain deferred.

The original workbook was read only with the bundled Python/openpyxl runtime.
No app import, remote publication, build or paid AI operation was performed.

## Approved implementation and verification in progress

Owner explicitly authorizes local and email imports with Mercalys feature parity.
Implementation extends the existing pipeline rather than introducing another
parser service, agent or provider. Local migration 66 and Mongo migration 63,
source-backed publication, preview comparisons and product history are included.
The supplied 1,226-row workbook parses without issues and publishes in an isolated
SQLite fixture within the 3 MB publication cap, retaining all 172 review prices.
That fixture supplies synthetic matching products: it does **not** establish a
real-catalogue automatic match rate. The owner's data has not been imported into
the live application. Private evidence remains outside Git.

Synthetic tests cover local publication, duplicate refusal, explicit confirmation,
same-date correction/tombstones, restart persistence, XLSX and interrupted ZIP
email handoff, remote original proof, rejected tampering, idempotent replay,
legacy-client filtering and cross-device pull. Full checks and delivery identity
will be recorded after completion. No native or owner acceptance is claimed yet.

## Local verification completed

- `pnpm check`: structure, lint, all typechecks; 549 test files passed,
  5,466 tests passed. The usual 93 integration files/899 tests require their
  external fixtures and were skipped in this default run.
- Explicit local transactional Mongo run: existing Mercalys canonical sync and
  new purchase-price source proof both passed. PA plus migration tests: 13 passed.
  The initial shared local Mongo process stopped between runs; the final run uses
  a separate disposable local replica and passed without changing production.
- Targeted XLSX/ZIP email and local publication tests: 52 passed. Native component
  tests: two passed (precision/date/source/offline state, explicit confirmation
  prompt, viewer restriction, empty state).
- `pnpm format:check`, API build/import check and mobile web export passed.
- Review preserves the existing legacy publication size rule; only the new PA
  format uses the bounded 3 MB UTF-8 envelope. No dependency/provider added.

Delivery details are recorded below. These checks do not constitute physical
iPhone acceptance. Historical snapshots with
unknown units remain excluded; correcting the catalogue qualifies subsequent
imports, not the interpretation of old source records automatically.

## Delivery — 18 November 2026

- PR 539: feature `da33909299b3c7585e8a924af51c0f4d6e4a750b`, merged source
  `6f67d2a701d77923b07ec71aa4f64fd5970b7c1a`; identical tested trees.
- Exact push 44305486200, PR 44305523421 and master 44307366697 all successful.
  Full GitHub run: 641 test files / 6,359 tests passed, six tests skipped.
- API `dpl_4WGdCzjpJc47sCrb1QE3q2eUUwYn`, production configuration, Paris `cdg1`.
  Staged health/database and unauthenticated private 401 checked before promotion;
  public alias, JSON health/database and private 401 checked after promotion.
  Predecessor retained: `dpl_2RknNqVV9fa3ajnMemx14sfrjaBS`. Any rollback after PA
  publication must retain the new source reader/capability contracts.
- iPhone **0.1.0 (79)** compiled on the Mac with the existing production profile;
  verified signature, provenance, API configuration and PA feature markers.
  Archive SHA-256 `4a7f2cff1325fd0ef59a57595f15f1443c306bfec80e49fbff83c13353775d23`.
  Cloud inventories before/after show no new EAS cloud build.
- Apple accepted the exact local archive; build 79 is `VALID` / `IN_BETA_TESTING`,
  non-expired, present in the existing internal group with its single owner tester.
  No tester/group/public-distribution changes were made. Physical iPhone acceptance
  remains for the owner; it is not inferred from Apple availability.
- Evidence: private `maintenance/purchase-prices-2026-11-18/` outside Git.
  The supplied workbook has not been imported into the owner's live store.

Short owner recipe: import a dated file locally, inspect a product's PA/source,
repeat it to check duplicate handling, and receive the same format through the
existing store email inbox. Review/correction and explicit tiny-price confirmation
remain available from the canonical native paths.

## Build 79 incident — 18 November

Owner reports synchronization failure, emailed PA awaiting reading and intermittent
nonresponsive menus/sheets. `applyBootstrap` rejected the advertised
`purchasePrices` capability as unsupported. The new MobileSyncService regression
reproduced the exact rejection before the allowlist fix, then passed: an existing
device adopts PA once and subsequent sync resumes ordinary pull. Focused suites
(sync service, bootstrap, iOS sheet) passed 46 tests. No production data changed.

Older simulator runtime closes weather and sequential import sheets with X; this
does not qualify build 79 or explain the physical-device intermittent touch issue.
Sentry build 79 reports sanitized LOCAL_OPERATION_FAILED in synchronization.
No claim of a complete freeze fix; screenshot and device follow-up remain pending.

### Corrective delivery

PR 540 merged as `79167884345c9d90966a41f0abb712a62db010bf`. Exact-head
push 44315409678, PR 44315447580 and master 44317613272 passed. CI reports
641 passing suites, one skipped. Local full run had one observability test
timeout; its isolated rerun passed all nine tests; CI passed the complete suite.

Build 0.1.0 (80) compiled locally, archive verified, SHA-256
`79a989e35c902dd4202782238035554dea4fd97886a49a62c2b9109044310505`. Apple
accepted upload. Build 80 is VALID / IN_BETA_TESTING, not expired, and present
in the existing owner-only internal group (one tester). Physical-device
regression acceptance remains pending. Existing API PR 539
remains compatible and unchanged. Private evidence:
`maintenance/pa-bootstrap-recovery-2026-11-18/` outside Git.

Owner check is limited to this regression: update without resetting local data,
allow sync to finish, check the already emailed PA and menu/sheet interactions.
Intermittent freezes are not declared fixed by the bootstrap allowlist change.

## Persistent freeze report and responsiveness fix

Owner reports build 80 freezes after email admission, at “Identification des
produits”, plus synchronization error and unresponsive navigation after restart.
The admitted email processor resumes pending work at startup and calls the same
Mercalys preparation/matcher; its retries are bounded, not an identified infinite
loop. A synthetic workload of 172 difficult rows against 1,226 products blocked
the JS event loop for 1,174 ms on the Mac (zero timer callbacks). This is a
measured starvation path, not proof of every device symptom.

Mobile batch preparation, initial review and rematching now yield after short
slices (8 ms target or 20 rows), retaining the same deterministic match rules.
Read-only review can close while identifying products; unmount/store change aborts
matching and ignores late results. Publication/product mutation dismissal guards
remain intact. No original, pending command or price is deleted. Native parse
itself and an individual match remain synchronous.

Tests cover exact matching parity, UI heartbeat throughout a large rematch,
cancellation and closing a reading sheet without late analysis/publication.
Focused review/matcher/email/controller suites: 90 passed. Earlier review mocks
were updated to the asynchronous entry point and to await scheduled UI yields.
Build 81 delivery is recorded below; exact sync error and device acceptance
remain outstanding. Private synthetic probe: maintenance/import-responsiveness-2026-11-18/.

### Build 81 delivery

PR 541 merged as `0ee68ddc862e2811e2069e1c431b31aa5ce6077d`. Exact-head
push 44323652812, PR 44323731137 and master 44326002451 all passed.
Local lint/typecheck/format and 5,471 tests passed (899 environment-dependent
tests skipped); CI passed 641 suites, one skipped.

Equivalent synthetic responsive probe: 172 rows / 1,226 products, 1,411 ms
total, 103 timer callbacks, maximum observed gap 17 ms, versus 1,174 ms and
zero callbacks before. Mac measurements, not device timing guarantees.

Build 0.1.0 (81), local STORE archive verified, SHA-256
`d16c353e808edc20f16a979dc9aeb1e2558ab410b6a6904d0829fe35fb302683`.
Apple accepted upload. Build 81 is VALID / IN_BETA_TESTING, not expired,
and present in the existing owner-only private internal group (one tester).
API unchanged from PR 539. Private evidence in
`maintenance/import-responsiveness-2026-11-18/`, outside Git.

Focused device acceptance: update without uninstalling/resetting; allow the
existing admitted file to resume, test navigation during identification and
closing file review. Do not claim the synchronization error or every freeze
resolved without this follow-up. No production data was manually modified.

## Owner follow-up: build 81 responsive, email originals inaccessible

Owner reports freezes seem gone. Screenshots show last sync 18 November 15:57,
zero pending sends/conflicts and two failed EMAIL_INTAKE_PROCESS jobs with
EMAIL_INTAKE_ORIGINAL_CHANGED. File review reports the retained original missing.

Regression reproduced both messages after relocating an intact original: the native
adapter verifies its current scoped path but the manifest cache retained the old
path; the Mercalys reader only relocated XLSX paths, excluding email .bin originals.
A retry also needs to preserve the original immutable batch locator/identity.

Fix repairs only a physically verified cache locator, rechecks scope and manifest
inside the write transaction, accepts an equivalent concurrent repair, and reuses
the existing private-folder resolution for the four-level scoped email path/hash.
File review and background processing use the same resolver and keep size/hash
checks. The immutable XLSX intake batch keeps its initial locator. No file is
replaced, no original integrity error is silently erased, no server change.

Red proof: relocation and review tests failed with the exact two reported errors.
Green focused coverage also retries a failed admitted PA, publishes it once and
retains idempotency on a second retry; changed bytes and foreign folder remain
rejected. Existing failed jobs require the ordinary “Reprendre ce fichier” action
after delivery; no automatic rearming of unclassified integrity failures.

### Build 82 delivery

PR 542 merged as `0c0c1fba6a697f6b1c1208ce581390ee48e73824`.
Exact-head push 44331409329, PR 44331422107 and master 44333841122 passed.
CI: 641 suites and 6,371 tests passed; one suite/six tests skipped.
Local focused verification: 123 tests passed, including admitted PA retry,
duplicate retry, concurrent cache repair, changed bytes and scoped file access.
The first full local run exposed a test fixture lacking the production serialized
writer and an unrelated observability timeout; fixture corrected, both targeted
suites passed and complete CI passed. Local typecheck passed.

Build 0.1.0 (82) compiled locally, STORE archive verified, SHA-256
`cac112830fd2307ae7956e8c97fcb18d008cc5ca94fabb297243a07b5894e42d`.
Apple accepted upload. Build 82 is VALID / IN_BETA_TESTING, not expired,
and present in the existing owner-only private internal group (one tester).
API unchanged from PR 539. Evidence retained privately in
`maintenance/email-original-relocation-2026-11-18/release/`, outside Git.

Device follow-up: update without uninstalling/resetting, then Imports → documents
received by email → “Reprendre ce fichier” for each failed item. Open the retained
file, confirm PA review/publication and check synchronization after completion.
Owner reports freezes seem gone on build 81; PA recovery acceptance remains open.

## Build 82 follow-up: extended matching wait

Owner confirms the original now reads but reports four minutes at identification.
The email overview displays generic preparation while manual review runs its own
matching. No device trace yet proves whether catalogue loading, matching or other
concurrent work owns the delay. Do not claim a confirmed infinite loop.

Synthetic Mac probe: 172 unmatched rows, 1,226 active products, four validated
aliases per product. Original matcher 10,482 ms; prepared matcher with reused edit
distance rows 4,231 ms, full results identical to the retained previous implementation.
This is a synthetic throughput measurement, not the owner's catalogue or iPhone.
Prepare filtered catalogue/identifier/alias/normalized-label lookups once per
validation run; retain exact rules, scores, conflicts, ownership, cancellation and
yields. New validation after mutation gets a fresh snapshot. Review also displays
catalogue loading separately and examined-line progress. No matching thresholds or
publication permissions change. Private probe outside Git:
`maintenance/import-matching-2026-11-18/`. Device acceptance remains pending.

### Build 83 delivery

PR 543 merged as `07552c6c80187493573ec82fdd14ec67dc0ceb39`.
Exact-head push 44364214737, PR 44364259889 and master 44366396326 passed.
CI: 641 suites, 6,381 tests passed; one suite/six tests skipped.
Local check: structure, lint, typecheck, 5,488 tests passed (899 environment-dependent
skips); formatting passed. Additional native progress/cancellation tests passed.
Private old/new matcher probe verifies complete output equality for the measured
workload. Results do not establish actual iPhone duration or resolution of the stall.

Build 0.1.0 (83) compiled locally, STORE archive verified. SHA-256:
`fb4352a954b5c7e7d9c9ca1c0710442b7e9302ecc2d84697a3902b55f24ed039`.
Apple accepted upload. Build 83 is VALID / IN_BETA_TESTING, not expired,
and present in the existing owner-only private internal group (one tester).
API remains unchanged from PR 539. Private delivery evidence:
`maintenance/import-matching-2026-11-18/release/`.

Owner follow-up: update without uninstalling or resending the workbook, open the
existing import, observe catalogue-loading versus examined-line count and verify
completion/publication/synchronization. Retry a failed email job only through the
existing explicit action. No claim of device acceptance; last reported state is a
four-minute identification wait on build 82.

## Build 83 owner follow-up: product creation and repeated review

Owner can load the workbook and see the approximately 1,200-row counter. Product
creation (individual/distinct/batch) is slow without clear feedback. Closing the
changed review locks batch controls while a second preparation runs, and reopening
always rematches. A PA count eventually appears; this does not confirm full source
publication or synchronization.

Reuse one view-owned validation snapshot keyed by verified checksum, store and
complete current catalogue contents; recheck original bytes and all publication,
continuation and overlap rules on every open. Catalogue/source change invalidates
reuse. Snapshot is bounded to one file and does not persist across app restart.
Closing review writes its completed result with a version check instead of running
another preparation; incomplete changed review stays queued for explicit reread.
Do not overwrite a newer background result. Creation displays saving progress
immediately, followed by examined-line progress during rematching, near the action.
Matching still revalidates after product mutations because other candidates may
change. Do not claim every product creation is instantaneous or all device freezes
resolved. Device acceptance remains open.
