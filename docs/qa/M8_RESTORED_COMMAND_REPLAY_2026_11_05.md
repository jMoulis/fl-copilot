# M8 — restored in-flight command replay, 5 November 2026

## Missing combined case

The existing suites separately qualify exact Outbox preservation and normal retry. Add the combined restoration/replay case to `database-recovery-native.test.ts`, using its existing file-backed SQLite online-backup and filesystem/SecureStore ports. Actual mobile repositories produce a product command, a private conversation command and its user-message command. Actual Mongo push/processed-command transactions, bootstrap, pull and the mobile synchronization service provide the remote/application behavior. No mock acknowledgement substitutes for the server journal.

## Two controlled interruption boundaries

For both **before server commit** and **after commit with acknowledgement lost**:

1. Begin the canonical push; its three rows become SYNCING through the normal writer. Pause the transport before returning its result. In the after-commit case, the real Mongo service has already returned APPLIED for all three commands.
2. Create a consistent local copy while that push is in flight. Prepare the owned candidate. Release the simulated failed response; the old location retains PENDING commands.
3. Activate the prepared copy, reopen its selected SQLite location and verify its exact journal rows still match the saved SYNCING checkpoint, including IDs, payloads, sequence and attempts. The restored-owner marker matches the original owner.
4. Run ordinary `MobileSyncService.sync`: interrupted-send recovery requeues the same commands. Real Mongo returns APPLIED for the before-commit case or ALREADY_APPLIED for the after-commit case.
5. Verify local acknowledgements, identical sent commands/payload JSON and incremented attempts. Mongo retains exactly three processed commands, three sync changes and one product at version 1. A further sync sends nothing.
6. Resume the retained previous location through the same prepare/activate/reopen path. Its PENDING commands also return ALREADY_APPLIED; command and change counts stay at three.

The recipe uses random isolated test stores/owners/device IDs and a uniquely named disposable Mongo database per case. The local test server binds loopback only. No production database, real store mutation, upload, model request or paid provider is involved. Each test removes only its own test database/files and closes its connections.

## Results and limits

**21 tests in the native-recovery suite pass, zero skips**, including the two new transactional Mongo cases. Combined local validation passes **231 tests across eight files, zero skips**: 221 migration/recovery/sync/Outbox cases across six files with transactional Mongo enabled, plus ten provider/owner-session cases across two files. Exact-head CI is recorded separately. Workspace types and targeted lint pass. No runtime, schema, endpoint, command format, model instruction or recovery layer changes.

SQLite and Mongo are real engines; Expo filesystem, SQLite bridge and SecureStore are controlled ports. The test reopens actual database files but does not terminate an iOS process or perform real authentication/HTTP membership checks. Those boundaries retain their existing focused native/session evidence and security gates. This combined test does not claim physical iPhone recovery of queued business changes, arbitrary corruption salvage, pending-binary upload replay or cloud backup restoration.

## Current M8 reconciliation

M8-T03's declared requirement—upgrade/reopen every supported SQLite schema and preserve Outbox—is satisfied through schema 62 by the existing 132-case migration matrix (62 upgrades, 61 rollback/retries, nine SIGKILL/WAL cases), the surrounding preservation suites and current-schema native restoration evidence. Mark **T03 closed for the current schema range**, retaining regression qualification for future migrations. Do not keep it open solely for cloud backup or arbitrary corruption: those are T12/T04.

T04 remains active for the remaining native interruption/corruption/source cases. T12 production Mongo/original/read-model backup restoration remains open. Android and the dedicated accessibility pass remain in M9. No new EAS build or API deployment is required by this test/documentation increment.
