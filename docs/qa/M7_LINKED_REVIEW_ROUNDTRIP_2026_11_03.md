# M7 — linked descriptive review persistence, 3 November 2026

## Scope and proof

A single integration scenario joins the existing decision/execution association, read-only task review, private reply persistence and canonical mobile synchronization. It uses an isolated transactional Mongo database and a second SQLite file, closed and reopened on disk.

- Confirm the existing fixture association locally, synchronize twice, then read the owned link and its exact decision/task snapshot.
- Read before/during/after performance through the canonical review reader with the saved choice version; generate a scripted sourced reply and replay the same turn without generating another reply.
- Bootstrap a second local database with the current analytical-source capability, close/reopen its file and recover the exact association and reply, including the numerical citation and analytics destination.
- Withdraw the association through its existing local writer and synchronize. Correct an isolated performance input: a fresh review reads the corrected number while the retained historical reply stays unchanged.
- Assert the original choice and execution task remain identical, with no new task or second generation.

The original eight association tests still cover privacy, old clients, retries and stale state. The direct test transport now optionally advertises the current source capability, matching the API client's existing version-2 header. Its old-client default is unchanged. Missing metadata in the first test run came from this test transport default, not a reproduced application regression. No runtime correction was necessary.

## Boundaries

The plan, decision and DONE task are explicit isolated fixtures, not actual store execution. The provider is scripted: this proves storage/reader/synchronization behavior, not natural-model quality or a physical second-device test. The restored source describes historical observed figures; it neither certifies causality nor becomes a live value when inputs change.

No production mutation, paid model call, new tool, writer, entity, migration, API deployment or EAS build. This advances the technical proof for workstream 5; the real recommendation → explicit choice → actual execution → useful review pilot remains open. M7 states remain **1/3/4/5/6/7 ongoing, 2 code ready**.

## Delivery baseline

The preceding qualitative TG reader is already released in API source `fe57a80aae4797b560671334d99eb32fd57bbc79`. iPhone build 23 contains the grouped weekly UX. The owner explicitly accepted its four requested journeys on 3 November; that weekly UX lot is closed. Historical chat-card visibility remains separate. M0–M6 functional iPhone baseline stays closed; deeper implantation/UX and daily purchase-tariff intake remain deferred.

## Validation

Nine association integration tests pass with isolated transactional MongoDB, zero skips, including the new disk restart scenario. Full structure/lint/typecheck pass; the default full suite passes 4,702 tests with 747 environment-gated skips. The nine Mongo scenarios above are run separately without skips. Exact-head CI is recorded separately in the PR.
