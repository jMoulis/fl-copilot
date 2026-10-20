# Durable illustration preparations — 20 October 2026

## User story and boundary

From a current, private allocation scenario, record its illustration preparation offline, close/reopen, synchronize exactly once and restore the identical preparation on a clean second local database. The original historical physical revision and allocation remain the source. This increment records **PREPARATION_ONLY**; it is neither generation approval nor a paid task. Reconnection, a future provider activation and a duplicate command cannot authorize spending.

## Implementation

Shared strict Zod entity `LayoutIllustrationPreparation`, immutable version 1, stable UUID, store/owner/conversation/card/assistant identities, renderer and SHA-256 hashes of the parsed allocation and complete historical physical plan. Shared binding compiler prevents drift between native persistence and the server's source compiler. Known collisions or required floor geometry missing block preparation; unspecified heights, loads and passage constraints remain limitations, never inferred dimensions.

SQLite migration 57 and Mongo migration 49 add `copilot_layout_illustrations` / `copilotLayoutIllustrations`. Local preparation and standard `COPILOT_LAYOUT_ILLUSTRATION_PREPARE` Outbox insertion share an exclusive transaction; cancellation or enqueue failure rolls back both. Reopening/repeated taps reuse an existing local preparation for the same source. Retries preserve IDs/payload; two independently created preparations remain distinct unpaid records. No generic last-write-wins, generation status, provider key, image or budget permission is accepted in this entity.

The standard authenticated push verifies owner, active membership/conversation, visible private card/assistant chain and historical source hashes before both mutation and cached command replay. Transient database failures propagate to the retry path. One canonical change and one immutable remote entity are created. Normal ACK clears pending state; a pull does not incorrectly acknowledge a dirty local command. Pending/failure/conflict counts exclude other owners' private work.

Capability `layoutIllustrations=true` is independent of older chat capabilities. Legacy clients omit preparations. Bootstrap supplies at most 50 owner-scoped records and a history-required marker; the existing owner-authenticated history endpoint pages the remainder with `recordType=LAYOUT_ILLUSTRATIONS`. Native restoration validates owner, descending timestamp/UUID tuples and cursor progress before recording adoption. A bad page leaves retained partial rows and no false adoption marker, allowing safe retry; incremental pull catches changes since the bootstrap baseline. No unbounded bootstrap or separate sync endpoint.

In the existing scenario sheet, “Préparer l’illustration” records the unpaid intent and displays À synchroniser / Synchronisée. Missing source geometry links to the existing store plan after closing the sheet. Current-source and manager permissions govern new preparation; no new tab, agent tool or global model instructions. Existing preparations remain historical source references, never proof that the latest plan is current or commercially adopted.

## Verification

Local full check: 2,839 tests passed / 598 skipped, including 13 native repository/sync tests and two backend unit tests. File-backed SQLite covers restart, idempotent retries, outbox rollback/cancellation, source edits/deletion, roles/private accounts, ordinary ACK and invalid paginated restore/retry. Four new Mongo transaction scenarios cover SQLite → push/replay → bootstrap/cold database, owner/source/revocation controls, legacy capability and a 126-record paginated restore. Those four require transactional CI; local checks alone do not prove them.

A disposable route mounted the production scenario sheet and illustration panel with clearly labelled synthetic geometry and in-memory UI ports. Static web export avoided a local Metro EMFILE watcher limit without a Mac configuration change. At 390 px: prepare once → pending; simulated ACK → synchronized after reopen. At 320 px: missing geometry and stale-source controls disable preparation; the plan callback closes the source sheet. Page width remained 320 px, console errors empty. Screenshots and harness are retained in the task artifact folder. This web exercise does not prove native gestures, real server ACK or durable storage (covered separately by repository/integration tests). QA route/data are removed before release.

## Delivery and remaining work

Code under verification, not deployed or present in iOS build 5 (`1e7684d`). Compatible API/migration must precede the future grouped binary. No new EAS build, production deployment, AI request, provider activation, environment-file access or system setting change for this increment.

Workstreams **6 and 7 remain in progress**; **1/3/4/5 remain in progress, 2 code ready**. T28 still requires separate explicit budget authorization/attempt reservations, private original/result storage and offline restoration, durable generation/recovery (including outcome unknown), source/result comparison and freshness, optional actual store photos, provider/model activation approval and real measured/native acceptance. The preparation alone does not complete image generation or V1/M8.
