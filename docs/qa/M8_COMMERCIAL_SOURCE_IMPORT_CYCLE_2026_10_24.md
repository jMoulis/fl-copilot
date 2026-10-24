# M8 — commercial source import cycle, 24 October 2026

## Observed problem and change

Local Metro runtime QA on PR 367 reported this cycle:

```text
conflict-review → conflict-policy → week-plan-context
→ physical-allocation-sources → offer-choice-repository → conflict-review
```

The physical-allocation source reader constructed the complete offer mutation/review repository only to read an exact offer. Its unchanged, store-scoped single-row SQL now lives in the existing `choice-read.ts` beside the list reader. Both the repository's existing `get` API and the physical-allocation source reader reuse it. The same canonical payload/remote/error mapping, transaction-bound database, missing-record behavior and conflict refusal remain in place. There is no new module, schema, migration, business writer, model instruction or permission.

## Evidence

- **114 tests pass in four existing suites:** retained offer persistence/Outbox/restart, weekly-plan validation, commercial conflict groups and chat physical-allocation preparation. An additional scenario in the preparation suite changes the selected offer to CONFLICT between preview and confirmation; it is refused without Outbox or private-result writes.
- The same temporary local Expo Web harness as the preceding QA renders three explicitly simulated conversation rows. The root mounts no application providers, session, API or SQLite. Metro loads **2,653 modules** before and after; the recorded cycle warning is present before and absent after. The rendered route loads, and its browser warning/error log is empty after the change. The separate preexisting Metro DevTools installation message is still present; no global toolchain change was attempted.
- The temporary route/root were removed, Expo's unrelated automatic tsconfig rewrite restored, the owned Metro process stopped and temporary browser tab closed. Raw before/after logs and harness copies are retained privately in `artifacts/commercial-source-cycle-2026-10-24/` in the task workspace, outside Git.
- Full local `pnpm check` passes: **4,358 tests / 717 skipped according to environment**, ten strict TypeScript projects, lint and structure. Exact-head push/PR CI must pass before merge; final evidence is recorded in the private verification record.

## Scope and remaining gates

This proves removal of this observed dependency cycle, not the cause or cure of any historical device crash and not an absence of every possible runtime cycle. Device startup, gestures, storage/network resilience and the complete V1/M8 acceptance remain open. API behavior is unchanged; this correction is outside build 15 and will join a future native batch. No isolated paid EAS build, provider call, production data mutation or API deployment is required.

M7 workstreams **1/6/7** advance by reducing coupling in conflict/physical-plan initialization. Global states stay **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**; no whole workstream is closed by this refactor.
