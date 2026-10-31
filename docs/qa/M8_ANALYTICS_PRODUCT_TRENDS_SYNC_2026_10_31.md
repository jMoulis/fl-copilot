# Product trends and synchronization recovery — 31 October 2026

## Requested behavior

The owner accepts the persil conflict resolution and requests quick product declines in Analyses plus investigation of two synchronization errors. Keep the corrective programme and seven V1 workstreams; this is not a new Copilot capability.

## Product list

Use Tous / En baisse / En hausse / Sans comparaison and order by current amount, comparable monetary difference or percentage, ascending/descending. Selecting declines defaults to most negative monetary difference first; rises default to greatest difference first. Compute comparisons through existing shared arithmetic on the same qualified ISO-equivalent/explicit periods. Filter/sort the full bounded selection before the 20-product page, with deterministic ID ties. Missing values sort last in either direction and are never zero; stable products stay in Tous, a zero reference keeps its valid monetary delta while percentage remains unavailable. Main totals, categories and analytical scope stay unchanged.

The default amount path preserves page-only comparison work. Additional per-product comparisons are calculated once when the requested filter/order requires them and reused on the visible page. No per-row database query or listener. Optional typed `productList` in existing local Explorer frames preserves old saved states and product/period drill, back, exact scroll and file-backed restart. No business migration or new sync entity.

## Synchronization findings and recovery

The HTTP route selected principal forwarding by a Copilot name prefix, while the canonical private registry also includes `email_intake_decision`. A standalone email decision could reach its access check without an owner; route selection now reuses `isChatType`. The authenticated owner remains authoritative even for a spoofed payload. Deleted, foreign and unavailable conversations remain denied by the existing server policy.

Read-only production checks find no processed command for the supplied reference `04907d8b-bc74-45be-8c23-5be988e6a0c3`, no remote email decision, and one retained email receipt whose conversation was deleted on 24 October. These facts are consistent with a preflight refusal but do not reveal the exact local command payload. No production record was modified.

The screenshot also shows one failed deterministic local calculation, which is not a server send. Its raw error is stored only on the phone and is absent from the screenshot; do not infer that SQLite locking actually happened here. The UI classifies known lock messages as `ANALYTICS_SQLITE_BUSY`, retains safe existing codes and supplies `ANALYTICS_LOCAL_CALCULATION_FAILED` for otherwise hidden errors. Explicit retry validates retained payloads, transactionally requeues at most 100 FAILED analytical jobs, preserves lifetime attempt counts and leaves source transfer/business jobs untouched. The existing scheduler/yields perform recalculation. Context closure rolls back queued work.

A refused email intent can be explicitly retired only when the current owner/store, immutable action/decision identity, retained ERROR decision without remote acknowledgement and typed local deleted-conversation intent still match. Validate any existing remote cache and its version; an absent cache does not prevent stopping an owner’s obsolete local intent. Keep the command FAILED with the existing `EMAIL_INTAKE_DECISION_SUPERSEDED` audit convention, keeping decision, originals and processing history untouched. This is not admission, server acknowledgement, undelete or cancellation of any already-applied remote action/job. Active conversations instead link back to their owned chat and its existing fresh-confirmation path. Double taps and retained callbacks after owner/store/database/focus closure are rejected.

## Validation and delivery boundary

Targeted tests cover whole-list decline pagination, different euro/percentage order, zero/missing/reference-zero, stable ties, native real controls, drill/back and real SQLite restart. Mounted recovery actions cover double tap and account replacement; real SQLite tests cover explicit analytical retry/rollback/attempts and safe retirement with active/foreign/unverified/cancelled contexts and immutable sources. The HTTP test binds the authenticated owner for a standalone email decision and rejects anonymous requests. The existing 22-test real Mongo transaction suite for email decision/processing passes separately.

Final local `pnpm check` passes **4,566 tests / 732 skipped**, with all ten strict TypeScript projects, lint/structure, formatting, free API build/import and iOS/Android export green. Mongo-dependent checks are covered separately above and in exact-head CI. Exact-head push/PR and merged-master CI remain required. Deploy the API fix before grouped native delivery. Phone acceptance must verify filter order, back-navigation, the actual failed-calculation retry and old email refusal retirement. The original local error and four remaining pending sends cannot be diagnosed conclusively without that device’s state; no automatic clearing or fabricated acceptance. Full V1/M8 remains open.
