# M8 — shared evidence transport, 9 November 2026

## Evidence and scope

The real explicit merchandising retest completes in about 15 seconds with 46,274 input tokens, including 21,166 cached, and 590 output tokens. Three expert steps discover tools, consult five contextual readers and answer. Both curated reference cards are actually cited. This establishes access and a useful answer, not spontaneous retrieval, universal quality or token efficiency. The earlier request/history differ, so its token count is not a controlled baseline.

The existing analytical transport shortens evidence IDs and shares exact detail text, but other business readers still send their canonical evidence envelopes. Reuse that transport for all accepted evidence-bearing reads. Preserve the installed SDK's specialized binary/image converters. Small nonanalytical results retain their original representation when compaction would increase UTF-8 bytes. Record content-free before/after bytes for all read families through the existing usage callback.

## Invariants

Only the ephemeral model representation changes. All business records, product/document/task/decision IDs, versions, exact values/nulls, coverage, pagination, card source findings, application hypotheses, limits, source metadata and native citations remain intact. Canonical evidence IDs/source IDs/versions stay server-side and are restored by the existing reference binder. Original snapshots, provenance hashes, stored responses and synchronization contracts are unchanged. Nonanalytical evidence never counts towards the analytical output-budget threshold. Failed/unaccepted reads do not expose staged references; different read families share one turn-local reference namespace.

No new tool, agent, model request, dependency, configuration, business query, database model or mandatory lookup. Existing budgets and authorization remain. Replace the word “Analytical” with “Tool” in the existing table-format sentence rather than add prompt instructions. No native build is needed.

## Controlled measurements

Actual preparation, saved-plan, store-settings and expertise readers run on isolated local Mongo fixtures; the model transport is simulated. These are UTF-8 JSON bytes for the same returned records, not production tokens or billing.

| Reader                 | Before |  After |
| ---------------------- | -----: | -----: |
| Commercial preparation |  3,626 |  2,927 |
| Saved plan             |  5,584 |  4,888 |
| Store settings         |  1,547 |  1,483 |
| Curated expertise      |  7,741 |  7,603 |
| Total                  | 18,498 | 16,901 |

The sample is 8.63% smaller. The modest reduction does not explain or solve all repeated context consumption. Actual token savings and model choices require a later real exchange; no paid synthetic request was made.

## Verification

Three selected regressions fail on the previous runtime: cross-family reference restoration, real-reader snapshot transport, and curated expertise through the actual SDK to native source reopening. They pass after the change. Tests compare original records and reconstructed evidence fields, preserve every cited primary source/review date, and keep analytical budgets separate. Existing monthly/streaming, original-PDF, forged-reference, scope, durable-reply and title cases remain part of the targeted qualification.

**394 tests in ten suites pass, zero skipped**, with transactional localhost MongoDB, including the scripted monthly workload in both streaming modes and its 108-fact case. Ten-project strict types, targeted lint, formatting and API bundle/import checks pass. Exact-head GitHub checks, merge and API release are recorded separately. Do not infer a delivered fix or full M8 closure from local tests.
