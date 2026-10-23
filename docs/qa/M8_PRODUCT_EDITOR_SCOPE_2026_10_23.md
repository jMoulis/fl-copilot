# Product editor session scope — 23 October 2026

## Finding and change

The manual product hook retained its original store in the asynchronous save closure. The aggregate writer checked product ownership, version and conflicts, but had no live editor-scope fence while waiting for the exclusive local writer or completing its transaction. A retained callback could therefore continue after its owner/store/editor changed. This is a local stale-session defect; it is not evidence of remote privilege escalation or of a production incident.

The existing hook now supplies a live owner/store/product/database/device scope assertion to the existing aggregate writer. It rejects old callbacks after logout, owner/store/target changes or unmount; an identical session refresh retains the same scope. The assertion runs before requesting the writer, inside its transaction and after its aggregate/Outbox/recomputation writes, so cancellation rolls everything back. A changed session also prevents a stale refresh or successful confirmation in the new screen. There is no network/token check, new permission model, schema, queue or polling. Existing product edit permissions are unchanged; manager-only visual approval and physical-layout permissions remain separate.

The form explains the changed account/store instead of reporting an unexplained local database failure. Existing snapshot comparison, identifier collision checks, history, unsaved-exit protection and idempotence remain authoritative.

## Evidence

- Before the fix, three real SQLite edit cases resolved successfully despite revoked scope (before acquisition, while queued and after writing); the original seven cases passed. Baseline: private `fl-editor-scope-baseline.log`.
- Six real SQLite cases cover both create/edit at those stages and compare all rows of products, identifiers, aliases, Outbox and local jobs before/after rejection. Existing product-day data exercises recomputation on the edit path; no publication or source is replaced.
- Seven mounted hook cases cover retained callbacks across owner/store/logout/unmount/target changes, a delayed writer across a same-store owner switch, and an unchanged offline session including replacement of its session object. These use a controlled writer port; the separate SQLite tests prove transaction rollback.
- Existing form, read-invalidation and product navigation stress tests remain part of the validation scope. Record final local/CI outcomes before merge; do not equate the Node SQLite bridge with physical device acceptance.

Local validation: 30 targeted tests pass without unhandled rejections; the full suite passes **3,315 tests with 635 environment-gated skips** (376 passing files / 70 skipped). All ten strict TypeScript tasks, structure verification and lint pass. Push and PR CI must still run on the final exact commit, including real MongoDB and fresh native exports; local skips do not prove those gates.

## Delivery and remaining gates

This change is not included in the already uploaded iOS build 13 (`5838bd8`). It joins a later coherent native batch; no paid build or API deployment is justified by this change alone. The existing API and local schema remain compatible. The full role/permission matrix, cross-device lifecycle, Android, native keyboard/performance and complete M7/M8 owner acceptance remain open. M7 workstreams 1/3/4/5/6/7 remain in progress; workstream 2 is code ready.
