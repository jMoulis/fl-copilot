# M8 — bounded selected-original restoration

The local original-reselection recovery adapter read the entire copied PDF/XLSX into JavaScript memory before hashing (up to the existing 100 MiB limit). This path is distinct from the already-streamed remote download and original opener. It could unnecessarily increase memory pressure during recovery; no actual device crash is attributed to it by this test.

The adapter now reuses `verifyPrivateOriginalFile`, with the expected size/checksum supplied from the existing reviewed original. It reads at most 1 MiB per chunk and yields every four chunks. The repository still rechecks the current authority, review basis, exact copy metadata and ownership before its canonical transaction. No schema, API, migration, Outbox contract, dependency or automatic replay changes.

The selected original and existing restoration destination are never overwritten. A failed copy or size/hash proof removes only the disposable destination created by that attempt. The returned checksum is the expected checksum only after the copied bytes have passed verification. The local helper does not claim new MIME/header verification; existing repository/source checks are preserved.

## Validation

Five new native-adapter cases cover a 9 MiB-plus original with no whole-file reads, bad checksum, a source shortened during copy, copy failure and an existing destination. File/Expo ports are controlled; this is not a physical iPhone memory benchmark. Existing real-SQLite recovery tests retain owner-change, commit/rollback, reference identity and replay coverage.

- 115 tests passed across source-original-files, source-upload-recovery and source-original-transfer; zero skips.
- Ten-project typecheck and targeted lint pass.
- Native delivery is pending the next grouped binary. No EAS build, API deployment, paid model request or production business mutation is triggered.

An initial test harness used a multi-megabyte deep array assertion and exceeded its five-second test timeout. Using a native SHA-256 readback comparison verifies all bytes without enumerating millions of assertion properties; the final three-file run passes. No runtime timeout was relaxed.

## Separate cloud backup gate

After the owner reauthenticated on 5 November, Atlas project `fl-copilot-dev`, Cluster0 (Free, AWS EU_WEST_3, MongoDB 8.0.37) showed **Enable daily backups**; its Backup page offered purchasing daily backups rather than an available snapshot list. The connector's cluster metadata alone did not expose backup status. Association with the deployed production API is not independently proven by the project name.

Current [MongoDB documentation](https://www.mongodb.com/docs/atlas/backup/cloud-backup/free-cluster-backup/) describes optional Free-tier daily backups in gradual private preview: four retained snapshots, $0.10/day capped at $3/month. Do not infer backup unavailability from the Free tier alone or from older documentation.

The owner explicitly chose to leave this subscription in waiting. No purchase, cluster upgrade, dump, production restore or alternate backup implementation was attempted. M8-T12 remains **open, owner-deferred pending backup availability and an identified isolated restore target**; source object access and read-model rebuild are also unqualified. Local copies and the successful replay rehearsal do not close this gate or provide device-loss/server-loss protection.
