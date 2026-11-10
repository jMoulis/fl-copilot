# M8 T01 upload interruption qualification

## Actual network and process boundaries

The previous queue tests inject transport failures and interrupted job states. Add three cases with a real loopback HTTP server, the canonical API client and SourceUploadQueue in child processes, file-backed SQLite in WAL/FULL mode and an actual parsed/published XLSX fixture. The native binary uploader is replaced by a Node HTTP/file port; the remote API/storage is a controlled test service. No production store, credentials, cloud outage or model call is involved.

1. Destroy the TCP socket after the first 1,024 bytes, before the remaining workbook bytes are sent. The queue returns an unsuccessful attempt, persists RETRY/PENDING and retains the original.
2. Send SIGKILL to the queue process after the server reads the first 1,024 bytes. No queue catch/rollback handler runs; reopening finds the existing upload job RUNNING and file UPLOADING. Ordinary processing recovers the interrupted claim.
3. Persist the complete received workbook and confirmation metadata in the test service, then SIGKILL the client before sending its confirmation response. Reopening still finds an unacknowledged job; the next init returns ALREADY_UPLOADED, the client skips a second binary transfer and completes the same source.

IPC controls when the binary sender continues beyond the first chunk. It selects the exact failure boundary rather than relying on a sleep or throughput threshold. Timeout termination rejects the test; it is not counted as a successful interruption. Actual process signal, received byte count and pre-response confirmation metadata are asserted.

## Preservation and ordinary retry

Each test closes/reopens the actual SQLite file and compares stable catalogue, source records, observations, Outbox payloads/IDs, publication tracking and application/device metadata byte-for-byte at the row level. The upload job keeps its ID and payload, unrelated jobs remain unchanged, source/file identities and retained paths/checksums/sizes stay exact. After retry, SQLite integrity and foreign-key checks pass, local and received XLSX bytes match, the job has exactly two attempts and the source is confirmed/validated.

The test service accepts one complete binary and records one confirmation. The lost-ack case receives two complete requests but the client sends the binary only once. A third ordinary queue process is a no-op: no pending upload, new verification, publication, command or job is produced. These counters qualify client behavior against the controlled protocol; production server transaction/idempotency guarantees remain covered separately by existing API/Mongo tests.

The existing implementation passes; no application correction or extra retry mechanism is added. An initial harness expectation incorrectly used UPLOADING after a handled socket failure; the existing catch deliberately restores PENDING. The final assertions distinguish this handled failure from the two real process deaths.

## Validation and remaining native gate

**42 tests in four suites pass, zero skipped:** three new upload interruption cases, existing queue recovery tests, six actual local-publication process-kill cases and existing publication tests. Workspace types, targeted lint/format and both exact-head checks are required before merge. Test artifacts stay outside Git. No runtime, schema, API, dependency, synchronization contract or AI instruction changes.

Read-only CoreSimulator access confirms the separate iPhone17Pro test device is booted and shows the existing application. Interaction controls are not exposed in this session and the Simulator GUI cannot be resolved at its expected application location; no native network-loss, process-kill or timing recipe is claimed. The working iPhone16e and owner phone are untouched. Build34 offline cold-launch and build44 Mercalys-history acceptance stay closed.

This closes the additional **automated host upload socket/process cases**, not T01 as a whole, physical-iPhone performance/T08 or cloud restoration/T12. The remaining iPhone recipe is a real authorized import interrupted during transfer, app termination with pending work and normal reconnect/retry with original/command identity and no duplicate observations. Use an isolated authorized test installation; do not inject fake business writes into the owner's real store. This test/documentation increment requires neither an API deployment nor an EAS build. PR486's separate mobile diagnostic change still awaits grouped native delivery; owner-deferred Atlas restoration remains open.
