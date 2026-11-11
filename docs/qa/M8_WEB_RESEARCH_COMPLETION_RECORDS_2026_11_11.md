# Web research completed-call records — 11 November 2026

## Reproduction

The owner retest after PR489 created a FAILED research reservation, unlike the original pre-execution refusal. With explicit authorization for at most two paid public diagnostic requests, the first isolated request reproduced the post-provider failure using the same public query and existing production model/configuration. No business database writes or secret exports were performed.

The provider returned HTTP 200, status completed, a 4,980-character final answer and ten valid citation spans. Its output contained two completed web_search_call records and a third record still marked searching. The adapter counted all three and rejected the answer as NO_CITATIONS. This establishes the defect reproduced by this diagnostic, not the exact missing arguments in the earlier pre-execution incident.

## Minimal correction

Read each search record status and qualify only completed searches. Preserve the provider max_tool_calls of two, max_output_tokens of 2,000, existing model/reasoning/timeout, citation span validation, public-query privacy checks and refusal when zero or more than two completed searches are returned. No new retry, agent, endpoint or business workflow.

## Verification and delivery boundaries

Four new cases exercise pending searching/in_progress records, zero completed searches and three completed searches through the real SDK with controlled transport. Three assertions fail on the prior runtime. All 272 tests in the three relevant suites pass, zero skipped; workspace typecheck and changed-file lint pass. Exact-head push/PR checks, protected-master merge, the second authorized real verification and ordinary API delivery remain separate gates. Diagnostic deployments are explicitly excluded from promotion; use a clean ordinary artifact for release. Build44 remains compatible. The owner chat acceptance and broader M8/Atlas reservations remain separate.
