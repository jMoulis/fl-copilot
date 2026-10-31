# Catalogue conflict adoption — 31 October 2026

## Owner acceptance and observed limits

Build 18: the owner validates Analyses; persil synchronization remains blocked after rereading. Commercial navigation was clarified and its acceptance remains pending; receipt occurrences will be tested later. Read-only server inspection still finds persil version 2, its original applied command and its older conflicting command, with no newer server resolution. The phone's SQLite flags, timestamps and Outbox have not been read. This does not prove the exact device blocker.

## Reproduction and change

Three real SQLite regressions failed against build 18 code: a verified version-2 remote snapshot with only CONFLICT commands, but a local SYNCED/PENDING/ERROR badge and differing timestamp/dirty flag, prevents any explicit decision. Further cases preserve a differing local label, and mounted native tests exercise rereading, selection and separate confirmation. Three additional regressions failed before the legacy recovery: v42 creates an empty snapshot table on upgrade, so an unchanged acknowledged row may never acquire this newer cache through incremental pull. The persil conflict predates v42; this explains a possible historical path, not a read of the actual phone database.

The manual catalogue repository permits only explicit ADOPT_REMOTE outside the normal CONFLICT state when the complete conflict group is valid, the current remote snapshot is verified and agrees at the reviewed version, and every outstanding command is already CONFLICT. Local equality and stale local flags are not authority to reject this explicit replacement when a verified remote snapshot exists. With no snapshot, the narrowly supported legacy case instead requires a clean SYNCED local row, an acknowledged remote version matching the conflict and full typed row equality with its retained server response. A dirty, differing or unacknowledged row with no snapshot remains blocked. Reads do not invent a cache or acknowledgement; the canonical explicit adoption records the reviewed server response. KEEP_LOCAL remains disabled outside the ordinary conflict state: no new edit is generated to repair a badge. The existing atomic adoption records the complete local and remote rows, preserves conflict evidence, and does not create a business Outbox command. Existing hash, cancellation, owner/store/role checks and transaction re-read remain required.

A real PENDING/FAILED command, active SYNCING command, unverified/contradictory snapshot, newer known version and oversized group still prevent this recovery. Blocking messages now distinguish sending, outstanding edits, newer versions and unverified snapshots rather than asking repeatedly to synchronize. No migration, API change, direct production mutation, new tool or automatic resolution is introduced.

## Verification and delivery

113 targeted repository/native/push/deletion tests pass. Final local checks pass: 4,527 tests and 729 local skips (including Mongo integration suites), ten strict TypeScript projects, lint, structure, formatting and free iOS/Android export. Exact-head transactional CI is recorded separately before merge. This change is outside build 18 and requires a future grouped native release; no isolated paid EAS build or API deployment is requested. Actual persil-device acceptance remains open.
