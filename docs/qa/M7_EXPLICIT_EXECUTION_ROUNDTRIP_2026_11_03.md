# M7 — explicit execution through the linked-review journey

## Gap in the previous proof

The preceding linked-review integration seeded a DONE task directly in both databases. It proved association, review persistence and source retention, but did not exercise the execution declaration writer in that same journey. This increment extends that existing test rather than adding another workflow or runtime layer.

## Integrated verification

- Begin with the existing saved private choice and validated plan fixtures, but no local or remote execution task.
- Declare the task through CommercialExecutionRepository.save: local PENDING state and the canonical COMMERCIAL_EXECUTION_TASK_UPSERT command are observed before synchronization.
- Synchronize twice through the real Mongo transactional push/pull services. The task becomes SYNCED, with exactly one execution audit record for the command.
- Confirm the existing decision/task association; read a qualified before/during/after review; persist and idempotently replay the scripted reply.
- Bootstrap a second on-disk SQLite database, close/reopen and recover both the exact declaration and the historical linked review/citation.
- Withdraw the association and correct analytical input as before: no second task, decision rewrite, historical-answer rewrite or second model generation.

The test transport now advertises commercialExecution when requesting/restoring those existing entities, matching the native capability. Its fixture can omit the initial declaration; the default for other tests remains unchanged. No runtime files, schema, tool, model, permission, migration, API behavior or application instructions change.

## Results and limits

Nine existing integration scenarios pass against an isolated transactional MongoDB with zero skips. SQLite and restart files are real; the model response and initial saved choice/validated plan are explicit fixtures. This does not prove live-model advice quality, the whole plan-validation UI, actual installation in the store or a physical second-device journey. Exact-head CI is recorded separately.

Test-only: no production mutation, paid AI request, API deployment or EAS build. M7 workstream 5 advances technically; the real recommendation → choice → actual execution → useful review pilot remains open. States remain **1/3/4/5/6/7 ongoing, 2 code ready**. The accepted M0–M6 baseline and weekly UX are not reopened.
