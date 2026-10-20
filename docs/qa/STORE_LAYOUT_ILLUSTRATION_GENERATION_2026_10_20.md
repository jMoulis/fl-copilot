# Explicit illustration generation — 20 October 2026

## Scope and operation

M7 workstreams 6/7, L10, extend the existing scenario/preparation/files flow. An unpaid preparation is never spending permission. The manager requests a private signed quote for its exact historical plan/scenario. The quote names the explicitly configured text/image models, one low-quality 1536 × 1024 PNG, a configured USD estimate and a five-minute deadline. Confirmation writes one stable decision UUID and its standard Outbox command in the same SQLite transaction. No direct generation POST, new agent or second work queue is introduced.

Server admission rechecks current authority, private source binding, policy, signature, expiry and physical/product/offer versions in the processed-command transaction. One quote nonce admits one decision. A Mongo governor serializes concurrent admissions before the first daily-counter upsert; global/store/account UTC-day confirmation counters reserve the configured estimate exactly once. One active attempt per preparation is allowed. A still-active owner may recover an already accepted immutable ACK after losing manager rights; a new decision still requires the manager. Inactive/private-parent access is denied.

**These are application confirmation and estimated-allocation limits, not guaranteed provider-invoice caps.** Text/image usage and actual charges can differ. Reservations are conservatively retained after refusal to submit or an uncertain outcome. The UI states this before confirmation; no synthetic test price is a production recommendation.

Existing Inngest dispatch and the existing 15-minute recovery job carry only decision ID/version. A transaction records SUBMITTED before the one provider invocation. Redelivery, worker races and restart can only inspect the lease or recover the same archived original; they cannot invoke the provider again for that decision. Lost responses remain OUTCOME_UNKNOWN; archive-network interruptions are retried from the conserved original. No claim of provider-level exactly-once billing is made. Event/step results exclude the quote/signature, prompt and image bytes.

## Storage and client behavior

SQLite 60/Mongo 51 add generation metadata, independent capability negotiation and bounded owner-scoped bootstrap/history/pull. The existing command journal supplies idempotency. Pull can advance progress before ACK; the pending decision remains pending until its actual ACK, and a late older ACK cannot replace a newer result. A fresh device restores progress from Mongo with its private preparation/history.

The existing immutable private bundle conserves the exact original first, then the viewing image and source files. The current comparison survives a partially downloaded newer image and an app restart. The 64 MiB per-store/account cache protects the actually displayed result and explicit offline copies, and can reclaim older unpinned versions of the same preparation. This refines the earlier PR 309 rule that protected every cached result for the currently consulted preparation. Business sources, decisions and pending commands are never evicted.

The production native component shows disabled, local pending, queued, submitted, available, refused and uncertain states. A completed synchronized result triggers the existing authenticated file refresh. Network failure preserves the saved local decision; no paid retry is implicit. The source plan is not adopted or executed by generating an illustration.

## Verification

Local canonical lint/strict types/unit tests, API bundle/import checks and Hermes iOS/Android export are required before PR. Real Mongo replica-set CI exercises the transactional path: quote → SQLite/Outbox → admission → one synthetic provider call → conserved original → nonempty incremental pull, bootstrap to another SQLite device, legacy capability omission, bad signature/expiry/foreign access, nonce/active/daily limits, racing workers, lost response, interrupted archive recovery, source/role/disable changes, concurrent global admission across stores, owner pagination, and cached ACK after demotion versus a forbidden new decision.

The provider, Blob and image content are synthetic ports. No real account, image charge, provider quota or generated-image quality is exercised. Local Mongo tests are skipped because a native ARM Mongo daemon is unavailable; exact-head CI, not local skips, must prove them.

A disposable route mounted the real generation component at 320/390 px with a visibly labelled fictional price. Annulation kept zero decisions; confirmation created one pending decision; submitted/success/unknown, disabled and network-error states rendered. Active followup remained available after the simulated manager flag was withdrawn. Both page widths equalled the viewport, without horizontal page overflow. Screenshots/harness are in the task artifacts. This is browser/component evidence, not native gesture, real SQLite UI integration or image-quality acceptance. The QA route/data and owned server/tab are removed before commit.

## Activation and delivery gates

Default: **disabled**. No `.env` file read/write, account configuration, real paid call, email, EAS build or system change is part of this lot. Operator activation requires explicit agreement on actual supported models, the full text-plus-image estimate and store/account/global confirmation limits, then deliberate configuration using the existing secret/provider/job infrastructure. A changed policy needs a new UUID; existing signed confirmations cannot silently authorize changed models or estimates.

Configuration names only: `LAYOUT_ILLUSTRATION_GENERATION_ENABLED`, `LAYOUT_ILLUSTRATION_GENERATION_POLICY` (JSON of the shared policy schema), and the existing OpenAI/Auth/Inngest secrets. No default model or paid fallback. If disabling an already activated service, retain its policy configuration while outstanding archival recovery is required: the workflow is registered for enabled or retained-policy installations; never-configured installations add no image workflow or periodic step.

Code readiness, fusion, grouped deployment and device acceptance are separate. Source/photo enrichment, actual model/cost activation, real image quality, native recovery/gesture/accessibility/performance and a measured store pilot remain open with the other V1/M8 gates. The seven workstream statuses are unchanged: **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**.
