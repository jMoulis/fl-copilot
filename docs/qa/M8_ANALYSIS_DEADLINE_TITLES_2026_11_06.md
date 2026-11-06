# M8 — analysis deadline and titles after failure, 6 November 2026

## Actual follow-up failure

The owner’s next monthly analysis on source `6d78fb2` fails with **COPILOT_AI_TIMEOUT**, confirmed by the production fallback log for HTTP request `59717723-4d55-4cd4-9e32-13dcef648525`. This is a different error from the former output-token ceiling. The expert ends at 90,007 ms with nine completed steps and incomplete usage. Two discovery steps, a Mongo field-dictionary read and six subsequent analytical reads precede the final synthesis. The last completed step is at about 45.6 seconds; no final model step completes before timeout.

Seven real tool results shrink from 193,765 to 114,637 bytes. Ten observed STEP logs, including the router, report 228,211 input and 1,217 output tokens; 166,684 cached input tokens are an included subset. The final in-flight synthesis has no returned usage: these counts are incomplete and are not a bill or a controlled savings benchmark. Do not classify this owner recipe as accepted.

## Focused correction

For the canonical Copilot response schema, make authorized analytics_query, analytics_period and mongo_aggregate definitions directly available alongside the existing Mongo dictionary. Other business tools retain native deferred discovery and the existing permissions. This removes the need to discover already-known primary analytical tools before using them; independent reads can share a model step. The fixture’s large business catalogue now completes through real SDK execution without a discovery call. This is transport capability, not a guarantee of the real model’s query choices.

Set the configurable expert deadline default to **180 seconds**, within the existing allowed maximum and the 240-second Vercel function lifetime. Explicit shorter configurations and caller cancellation remain effective. A read-only environment-name inspection finds no explicit production COPILOT_AI_TIMEOUT_MS override, so the new default will apply after deployment. Model identities, token ceilings (4,000 output), read/step bounds and retry count remain unchanged. No new background job, model request or provider budget setting.

The already validated title proposal from the light dispatcher now survives expert deadline/output failures and grounding fallback. Keep it as internal generation metadata on the typed error/response, then invoke the existing title callback **after the fallback assistant reply is durably committed**. A failed answer remains visibly failed; a title is not evidence of successful analysis. No extra title call. Caller cancellation, transaction failure, replay, manual-title priority, session/store ownership, archive/deletion and synchronization retain their existing protections.

## Verification

- 359 tests across eight suites pass, zero skips, including fourteen transactional disposable-Mongo title cases and the monthly streaming/non-streaming SDK workload with a large deferred catalogue.
- Three focused title-through-failure cases fail against the previous runtime and pass after correction: deadline, output limit and grounding.
- Title integration covers the durable fallback, one callback, replay, canonical history/change stream, manual ownership and native synchronization.
- Ten-project typecheck, workspace lint and API build/import pass. Exact-head CI, delivery and owner monthly acceptance remain separate gates.
- No production data write or paid synthetic AI request was used for the diagnosis/tests. No native build is required; build39 remains compatible.

Preserve deployment `dpl_DJ5t1ypoa5feLmzd1b1WWF4sC1AH` for rollback. After delivery, retry one ordinary monthly analysis and verify final completion, actual tool/call usage, sources/charts and the synchronized title. Neither a longer deadline nor passing mock-model tests establish real provider success.
