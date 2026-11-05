# M8-T01 — actual import process interruption

Six new tests exercise canonical Mercalys publication in a separate process with real file-backed SQLite configured for WAL/FULL. The parent sends SIGKILL after a checkpoint witness. No exception, cancellation handler or graceful rollback runs in the killed process.

For both sales and waste, stop after the first observation insertion, immediately before COMMIT, and immediately after COMMIT before returning success to the caller.

Each disposable fixture has a previously committed import/Outbox and retained XLSX bytes. The child invokes the current repository through the existing SQLite test adapter. Its transaction wrapper adds only checkpoint pauses. Node's installed TypeScript transformer and a test-local resolver for extensionless relative imports load the source; no dependency or application runtime layer is added.

## Verified result

- The checkpoint proves a new observation was inserted before interruption.
- Pre-commit loss reopens the exact prior database snapshot across sources, files, observations, catalogue, commands, jobs, device/sequence metadata and publication tracking.
- Post-commit loss reopens the exact complete checkpoint, including command identity/payload/order. The killed process never returns a fabricated success.
- SQLite quick and foreign-key checks pass; both retained originals have identical bytes.
- Canonical retry after rollback publishes once. After commit, the existing exact-duplicate error prevents extra observations, commands, sources or jobs.
- Previously committed source/command/job rows remain unchanged.

**137 tests pass across seven files; zero skips.**

| Suite                        | Cases | Boundary                                                           |
| ---------------------------- | ----: | ------------------------------------------------------------------ |
| Mercalys import interruption |     6 | Actual process death before/after commit                           |
| Mercalys publication         |    19 | Publication/correction, identity and transaction refusals          |
| Mercalys batches             |    26 | Interrupted prefixes, cancellation, failed siblings and restart    |
| Mercalys continuation        |    16 | In-flight packets, historical rows, rollback/reopen and duplicates |
| Source upload queue          |    13 | Offline authorization, confirmation retry, interrupted claims      |
| Sync service                 |    32 | Timeout/late acknowledgement, retry, renewal and concurrency       |
| Original transfer            |    25 | Retained originals, owner/cancellation/commit races, offline reads |

Ten-project typecheck, targeted lint, formatting and structure checks pass. Logs remain in task artifacts outside Git.

## Remaining boundaries

Actual process termination and SQLite here run on the development host, not on iOS. Companion upload/download/API ports are controlled; no real cloud outage or remote Mongo commit is claimed. The import child calls no network or AI provider.

T01 stays open for native offline launch, network loss during upload/import, termination with pending work and reconnection through the installed app. Do not repeat the accepted native draft-restoration recipe. T04 corruption recovery and owner-deferred T12 server backup remain separate. No EAS build, API deployment, production mutation or paid provider request is triggered by this test-only batch.
