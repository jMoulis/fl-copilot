# Known remote catalogue deletions — 20 October 2026

## Problem and decision

A product/code/alias conflict whose synchronized version has `deletedAt` could not be resolved from either Synchronization or the Copilot. Both choices were disabled, with a reference to a dedicated deletion recovery that did not exist. A matching DELETE pull also made the known tombstone impossible to compare.

The existing canonical catalogue resolver now permits **ADOPT_REMOTE only** for a complete, same-store, same-ID, same-origin/parent remote tombstone. Keeping a live local version cannot reactivate the deleted identity. An absent remote payload is not proof of deletion; a reassigned identity, newer unseen snapshot, concurrent sending, multiple conflicts, lost authority or cancellation still blocks resolution.

The native manual comparison and existing Copilot card label this choice “Accepter la suppression synchronisée”. The comparison acknowledgment and an explicit deletion acceptance are required. The local request/result journal records `acceptRemoteDeletion`; it is not model-supplied authority, a new remote command or permission to retire a different record. Ordinary existing comparisons retain their prior request shape. Journal comparison normalizes through the shared strict request schema so multiple consent fields remain stable after restart.

## Preservation and synchronization

The existing SQLite transaction keeps the local and synchronized values in `product_master_conflict_history`, marks previous pending/conflicted commands superseded, applies a local tombstone and resolves the conflict. No new business Outbox command is created when accepting the already synchronized deletion. The previous commands and business observations/sources remain intact. A late write failure, role withdrawal or abort rolls back all changes.

A matching, already observed DELETE snapshot is accepted only when its exact version matches the complete reviewed tombstone. A later DELETE or changed snapshot still requires a fresh comparison. The snapshot remains DELETE rather than being downgraded to UPSERT. The record can remain a local logical tombstone; ordinary later synchronization may prune a clean copy under the existing rules. Retained local conflict evidence is device-local, not a promise to restore unpublished edits on another device. It does not resurrect remote business data or imply execution.

The existing superseded-command filters remove the obsolete command from active pending/failure counts without deleting its history. Missing remote records, local deletion cancellation/recreation and identity reassignment remain separate open cases; this increment does not claim general conflict or CRUD completion.

## Evidence

Eight new SQLite cases cover the three entity kinds, file-backed close/reopen and idempotent replay, missing separate acceptance, matching/newer DELETE, unchanged source/observation rows, preserved raw local/remote history, zero active sends/errors after adoption, late failure/revocation/cancellation rollback, and missing/reassigned remote refusal. Existing catalogue and other conflict-controller suites remain applicable.

Three real Mongo replica-set scenarios extend the existing turn/preview integration: serialize the known deleted remote record through the real sync-push conflict service, persist the private comparison, confirm the canonical local adoption, leave Mongo unchanged, and restore the remote tombstone to another SQLite database. Local Mongo is unavailable and these scenarios must be proved by exact-head CI; synthetic AI output is used, with no actual provider call.

A disposable route mounted the actual `StoreConflictCard` using synthetic before/after states from the SQLite fixture, with a simulated controller. At 390/320 px, local/synchronized versions and deletion labels were visible, ordinary comparison alone left confirmation disabled, separate acceptance enabled it, and completion displayed no new-send requirement. At 320 px page width remained 320 px. Colours use the existing dark native tokens, including the manual comparison. This does not exercise the manual Auth/database-bound container, native touch/screen-reader behavior or production data. The QA route/data, owned browser/server and viewport override are removed before commit. Evidence is in the task artifacts.

## Delivery and remaining work

M7 workstreams **1 and 7** advance; all seven statuses remain unchanged: **1/3/4/5/6/7 IN_PROGRESS, 2 CODE_READY**. No migration, generic conflict engine, global AI instruction, provider/account setting or dependency is added. No API deployment, EAS build or paid request belongs to this increment. Native acceptance and the full V1/M8 gates remain open; the common push-tombstone path is distinct from an unknown remote absence.
