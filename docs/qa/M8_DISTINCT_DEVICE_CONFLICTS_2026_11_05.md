# M8-T02 — current conflict qualification

First replay of seven existing integration suites: **117 passed, zero skipped**, using a disposable local transactional Mongo replica and actual SQLite. Source review found that the recommendation-decision conflict scenario used separate databases but reused the same device UUID. This was a test qualification gap; no production conflict failure is inferred.

## Focused strengthening

Both existing explicit-choice cases now use three distinct device UUIDs and three file-backed SQLite databases. A and B record opposing offline decisions through the canonical repository. Assertions prove each Outbox uses its own device identity, and the remote processed-command journal contains both writers.

The existing scenario still exercises:

- Actual server conflicts, a second conflicted command, and a later remote revision.
- Preservation of B's rejected choice and A's accepted/modified history until review.
- Explicit keep-local and adopt-remote choices against the current complete group.
- Canonical sync, convergence and replay with one decision and no commercial task creation.
- Bootstrap/pull into C under C's own device identity, close/reopen and offline read with no pending command.

No schema, runtime, model prompt/tool, permission or writer changes. The test uses real Mongo transactions and SQLite, with in-process transport rather than HTTP authentication/native networking.

## Current requirement mapping

| T02 family              | Current proof                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product                 | Catalogue push refusal, full reviewed group, local/remote choice, tombstones, replay and third SQLite restore                                                                                                                                                                                           |
| NeedUnit                | Actual need revision conflict, explicit revision and canonical native comparison/sync; membership/substitution guards remain covered                                                                                                                                                                    |
| StoreEvent              | Field-capture identity, competing end times, explicit reviewed choice and preserved original capture                                                                                                                                                                                                    |
| Recommendation Decision | Distinct A/B device identities and persistent SQLite, latest-pull conflict group, explicit choice, C restore/reopen                                                                                                                                                                                     |
| ExecutionInstruction    | The retained pilot uses commercial execution tasks/declarations, tested for competing statuses/notes/actual locations and explicit rebase. The old generic bootstrap executionInstructions array remains an empty compatibility slot; it is not a separately implemented or newly qualified CRUD model. |

The execution row documents the implementation boundary; it does not silently substitute a new model or remove a requirement. Functional M7 acceptance remains unchanged. T02 stays open for physical concurrent-device qualification and explicit reconciliation of that old generic contract label with the retained pilot workflow.

## Results on current source

**524 passed across 13 files, zero skipped, in two runs.**

- Eight real-Mongo integration files: 125 (catalogue transport 8, commercial execution 9, private action declarations 8, recommendation decisions 11, reviewed store conflicts 74, need units 5, field events 8, two-device sync 2).
- Five SQLite/review/mounted-screen files: 399 (common reviewed pages 192, commercial review 92, need review 62, field-event review 28, decision review 25).
- Ten-project typecheck, targeted ESLint, formatting and structure pass.

These results certify tested code paths and controlled native UI ports, not physical iPhone conflict gestures, live model behavior or a real cloud outage. No production store data or provider service was used. The temporary Mongo replica and unique test databases are cleaned after verification. No EAS build or API deployment is required by this test/documentation-only change.
