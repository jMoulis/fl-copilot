# M0–M6 functional pilot closure — 2 November 2026

## Decision and scope

**M0–M6 are closed for their functional iPhone pilot baseline.** This reconciles existing implementation/acceptance records with the owner's latest confirmation; it is not full cross-platform certification, whole V1 completion or permission to remove remaining checks.

The owner states that the three requested journeys — waste receipts, commercial week and substitution consultation — work. Record this as owner-reported acceptance on 2 November, without inventing the installed build number, individual gesture logs, precise offline timings or source files. Earlier acceptance evidence remains attributed to its original date; later simulator/CI results do not become physical acceptance.

This checkpoint supersedes stale “next work/acceptance pending” text for the initial functional baseline in the historical ledgers. New defects are scoped maintenance tickets; new capabilities remain M7/extensions. A demonstrable regression of a core invariant must still be fixed, even though the original milestone remains historically closed.

## Per-module evidence

### M0 — Foundation

Status: **CLOSED — functional iPhone pilot baseline**.

Operational native/API/auth/SQLite/Mongo foundation; prior owner iPhone authentication and Sentry acceptance. Hosted API replaces the historical LAN-only remaining item.

Owner action: No new M0 phone test requested.

### M1 — Synchronization

Status: **CLOSED — functional iPhone pilot baseline**.

Initial T01–T12 completion, atomic Outbox/idempotency/cursor/restart and controlled cross-database propagation proofs; later owner sync/conflict corrections accepted.

Owner action: No new standalone M1 phone test requested.

### M2 — Products and Mercalys

Status: **CLOSED — functional iPhone pilot baseline**.

Recorded iPhone offline/import/restart/reconnect/upload gate, 147 product resolutions, corrected-file reconciliation and 10,000-row test. Current targeted verification/conflict checks pass without altering production data.

Owner action: No new import requested solely to close the initial module. The rare physical DIFFERENCE exception remains explicitly tracked in M8.

### M3 — Analytics and Today

Status: **CLOSED — functional iPhone pilot baseline**.

Explicit original target-iPhone exit acceptance plus later owner acceptance of retail comparisons and product trend filters/sorts. Shared deterministic parity remains the authority.

Owner action: No new M3 phone test requested; chat chart acceptance belongs to M7.

### M4 — Waste receipts

Status: **CLOSED — functional iPhone pilot baseline**.

Core iPhone acceptance dated 7 October plus owner confirmation on 2 November that the requested current waste-receipt test works.

Owner action: Requested waste-receipt journey accepted; no repeat requested.

### M5 — Commercial preparation

Status: **CLOSED — functional iPhone pilot baseline**.

Functional iPhone minimum accepted on 9 October, owner-approved direct-original strategy replacing compulsory extraction review, and owner confirmation on 2 November that the requested commercial-week test works.

Owner action: Requested commercial-week journey accepted. This does not declare any TG installed or close the M7 recommendation-to-bilan loop.

### M6 — Needs and substitutions

Status: **CLOSED — functional iPhone pilot baseline**.

T01–T11 implementation, prior catalogue/membership/relation/event acceptances, current isolated transactional evidence/score tests and owner confirmation on 2 November that consultation of substitutions works.

Owner action: Requested substitution consultation accepted. No production stockout, score change or production worker run is inferred.

## Technical checks executed for this reconciliation

On source `3f1c52026766d796dfd967f69287ef7acb4d93ec`, the targeted run passed **73 tests across 13 files, zero skipped**. It includes Mercalys remote verification/conflict preservation, substitution-core evidence/scoring/lookup, actual migrated SQLite evidence/score/lookup repositories, product-substitution Mongo integration and the evidence/score processor with real isolated Mongo replica-set transactions. Every integration suite creates and drops its own disposable database; no production source, graph, score or event is written.

The processor suite covers queued capture, audited publication, repeat/parallel recovery, corrected source revisions, rejected relations, unavailable sales, scope guards, atomic rollback, dependency waiting, stale human commands and capable bootstrap/pull. These are controlled engineering proofs, not proof of a real production worker run or a physical second-device restore. Log: parent workspace `artifacts/m0-m6-closure-2026-11-02/technical-closure.log`.

The preceding exact-head CI for PR410 passed 5,434 tests / 6 skipped on push and PR, including full Mongo integration, API build and native exports. This documentation change requires its own final CI checks; no new runtime release follows from it.

## Remaining explicit M8 acceptance checks

These remain required and traceable even after functional milestone closure:

- **M0:** Android native runtime/navigation/accessibility and extended session-renewal/secure-storage failure recipe on hardware.
- **M1:** complete interrupted-network/offline/restart/two-physical-device conflict matrix; a controlled two-SQLite/Mongo proof is not physical-device acceptance.
- **M2:** controlled physical remote-verification DIFFERENCE acknowledgement without altering published observations, plus Android XLSX/publication/upload/memory parity. Prepare an isolated account/device case; do not corrupt operational data to provoke it.
- **M3:** Android parity and pilot timing/accessibility measurements. New chat charts remain M7 acceptance.
- **M4:** extended interrupted photo transfer, storage/permission failures and long-ticket endurance beyond the owner-accepted journey.
- **M5:** extended notification/permission and offline/conflict matrix, cross-device original recovery; retired text-AI extraction is not a current prerequisite. Never fabricate an actual execution to tick a recipe.
- **M6:** end-to-end physical learning inspection on an appropriate real incident or isolated test case, production worker operational health and Android/second-device experience. Missing evidence may legitimately preserve null/unchanged scores; do not seed operational incidents or claim causal learning.
- **Common:** verified cloud backup/restoration, migrations/recovery, security, accessibility, battery/network and performance acceptance. Local copies are not proof of cloud restoration.

M7 full conversation quality, recommendation → decision → execution → qualified bilan, current UX delivery and the agreed deferred implantation work remain open. The owner has deferred deeper implantation until the group merchandising plan is supplied; PA tariff import is also deferred. Neither is a reason to reopen M0–M6.

## Delivery boundary

No schema, business code, model, provider, production data, API deployment or paid native build changes in this reconciliation. Build22/source192b342 remains the last available identified native artifact; PR410's weekly-result navigation is merged outside that binary. The owner's exact installed build for this confirmation was not supplied.
