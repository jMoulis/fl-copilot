# Weekly result navigation — 2 November 2026

## Problem and decision

Actions exposed preparation, confirmed plan/history and documents at the same level. A saved draft could therefore lead to an empty confirmed-plan view, and its “Ma semaine” return opened documents. The owner requested native UI tests and fewer competing destinations.

Use one existing `/commercial-plan` destination named **Ma semaine**. It reads the canonical local preparation and confirmed plan, preserves the explicit ISO week and shows a newer draft before the existing confirmed plan. The manual editor, documents, historical versions and alternatives remain reachable as secondary actions. No business model, migration, tool, provider call or new writer.

## Behavior and safeguards

- Actions → Voir ma semaine displays saved TG choices immediately, even before plan confirmation. Next-week entry uses the same screen with the next explicit week.
- Confirmed TGs lead the summary; long instructions expand on demand. Editing is a separate step. Empty offer lists, repeated source ideas, saved-state detail, review and restart controls no longer dominate the editor.
- Confirmation still uses the existing reviewed canonical transaction. Opening, reading or returning never confirms or declares execution. Conflicted drafts route to synchronization; plan issues/refusals remain visible even when a newer draft exists.
- The current confirmed plan alone owns execution. Archived versions are read-only. Background synchronization preserves the current snapshot; hidden screens stop rereading. Owner/store/week scope changes remount the overview; late effects are cancelled.
- Completed chat preparation cards link to the exact saved week. The link appears only after successful saving and does not perform a model request or mutation.

## Verification

`pnpm check`: **4,695 passed / 745 skipped**, 466 passing test files and 80 skipped. Lint, strict typecheck and structure pass. Mounted React tests use migrated SQLite/canonical draft and plan writers: saved qualitative draft, read-only opening/no Outbox, explicit lazy review, exact-week edit/source routes, newer draft after return, preserved confirmed execution and proper back fallback. Existing editor, Actions and confirmation suites continue passing. Card test verifies no link before saving and the exact week after success.

Actual Expo Go on the existing iPhone 16e / iOS 26.3.1 simulator via Device Hub, local Metro 8099: baseline empty plan and wrong return reproduced. Normal synchronization explicitly authorized by the owner completed with zero pending/conflicts/errors. The real week 45 data already contained a confirmed version 1: Crudités at the entrance and Vitamines on the other TG. This test did not create that confirmation.

Verified new Actions → Ma semaine, both real TGs, expandable instructions, manual editor and return without saving, read-only version 1 history, and return to Actions. Execution remained **0/2** throughout. No chat message sent, plan confirmed, preparation edited, execution declared or original deleted. Recording: `artifacts/weekly-results-navigation-2026-11-02/actions_to_week.mp4` in the parent workspace; it shows entry, summary, instructions and return. Local logs are beside it.

## Delivery and remaining limits

Mobile-only increment: no API deployment and no paid EAS build. These changes are not in installed build 22. Exact-head push and PR checks, merge identity and grouped native delivery must be recorded separately.

In the synchronized conversation, the historical preparation card was not visible in the inspected native message range although the canonical saved result was accessible through Actions. The completed-card link is covered by mounted tests, not declared accepted on that cross-device conversation. Its historical artifact visibility remains a separate diagnostic; this increment does not claim to repair it.

Advances M7 workstream 7 (and access to workstream 5). **1/3/4/5/6/7 ongoing; 2 code ready.** No complete V1/M7 gate is closed by this UI increment; owner acceptance on the grouped binary remains required.
