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

## Follow-up — include the original decision synchronization

The same integrated scenario now leaves the fixture’s choice in PENDING state after the actual CopilotDecisionRepository.save, rather than acknowledging it locally and inserting it directly into Mongo. Advice/source/card and the validated commercial plan remain explicit isolated fixtures. Before synchronization there is no remote choice or execution task, and exactly one pending COPILOT_DECISION_UPSERT. Two canonical sync passes produce one decision change and an empty pending Outbox, without creating the execution task. The task is then declared through the existing writer, linked and reviewed as above.

After the second on-disk SQLite database is bootstrapped, closed and reopened, the actual decision repository returns the exact synchronized choice, alongside the exact execution and sourced historical reply. Withdrawal and corrected input preserve those records as before. Existing fixture defaults stay unchanged for other tests. No runtime, model, schema, prompt, API or native binary changes are introduced.

Nine integration cases pass with real isolated transactional Mongo and SQLite, zero skips. The scripted provider is not a live-model evaluation; this follow-up does not claim that the owner’s two different real advice records form one chain or fill the banana’s unknown dates. It strengthens the technical workstream-5 loop while the same-recommendation owner pilot remains separately qualified.
