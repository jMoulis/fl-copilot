# M7/M8 — current context of a memory suggestion card

Status: native correction locally verified, grouped delivery and physical acceptance pending. No provider call or paid build.

## Reproduced on the actual component

Seven mounted cases failed before the correction: returning from the memory screen kept an old saved/synchronized claim while the new read was pending or had failed; a restored/replaced SQLite database retained the previous statement; scoped SQL rows were trusted without checking the parsed payload's exact knowledge/store/owner identity; and a retained navigation callback still ran after blur. These are display/navigation defects, not evidence that confirmation mutated the wrong memory record.

`KnowledgeSuggestionCard` now keys its read state to the exact SQLite/proposal/owner/store context. A focused read withdraws the previous claim; only a current valid response supplies saved/forgotten status. Pending/failed reads do not display the previous statement or offer a fresh proposal path as if absence were established. Failure opens the existing memory screen for inspection. Forgotten records remain redacted under the unchanged shared schema. Foreign/malformed payloads are refused, and an unowned proposal performs no query.

The existing local reader, shared domain schema and canonical memory editor/confirmation writer are retained. This adds no repository layer, mutation, model permission, global instruction, schema or migration. It does not add a global subscription per card: ordinary message rerenders keep the current result and perform no additional query. Late reads and retained callbacks are checked against current focus, database and scope.

## Evidence

- Before: **7 mounted tests failed** on the prior production component.
- After: **9 mounted tests pass**, including valid forgotten state, failed reread, three exact identity boundaries, database replacement, late prior-database result, blurred callback/foreign proposal and stable ordinary rerenders.
- Targeted memory suite: **55 tests across 6 files**, including canonical confirmation/forgetting/conflict/repository and transactional Mongo integration, pass without skips in the configured local environment.
- `pnpm check`: structure, lint and all ten strict TypeScript projects pass; **4,336 tests passed / 717 environment-dependent skips**.
- Formatting and `git diff --check` pass. Exact final push/PR CI, merge and installed acceptance are separate gates.

The renderer uses mocked native focus/controls and controlled read responses. It proves component behavior, not iPhone gestures, physical app acceptance or new real-model judgment. It does not erase chat history or claim that forgetting a private practice deletes its source message. Background changes are re-read at the existing focus boundary; no claim of a new live memory subscription.

## Grouped device recipe

Keep existing data and build-14 acceptance separate. On the future grouped binary: open a saved suggestion, inspect/forget it in Memory, then return while a read is slow or unavailable. The card must not claim an old synchronized practice or offer an unverified new confirmation. Reopen the memory after recovery. Verify scope after connection/database restoration without resetting the app. Confirming/editing/forgetting still uses the normal human-confirmed memory screen and Outbox. No paid EAS build is started for this isolated display correction.

Seven M7 states remain **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This advances memory UX and M8 context fidelity; it does not close expertise, full parity, hardware or V1 acceptance.
