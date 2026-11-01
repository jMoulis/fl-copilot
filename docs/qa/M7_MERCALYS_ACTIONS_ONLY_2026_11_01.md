# Mercalys manual imports belong to Actions — 1 November 2026

The owner tightens the previous simplification: no Mercalys import entry remains in chat, including an embedded classic importer. Manual intake is exclusively the existing Actions → Imports Mercalys workflow.

Remove the composer callback/action/menu item, embedded importer/modal/busy state/discussion handoff, local lot summary and its component. Historical message cards retain their filename and a passive direction to Actions, without a button or processing callback. Do not remove original files, batches, private references, observations, publications, cached decisions or email handling. The existing Actions importer is account/store scoped and its unfiltered repository includes retained conversation-owned lots; no data migration or second file copy is needed.

The existing attachment instruction now points to Actions instead of Fichiers. No new prompt section, tool, endpoint, permission or model call. PDF/photo/email attachment workflows remain unchanged.

## Checks and delivery

- **292 targeted tests passed**: passive historical card mount/rerender with no Outbox/message/publication changes, old lot available through the Actions repository, iOS dismissal before the remaining email action, existing import isolation/pagination/source tests and controlled Copilot SDK regression.
- Full local structure/lint/typecheck/test passed: **4,598 passed / 742 skipped**. Formatting, API build/bundle import and iOS/Android export passed. Exact-head push/PR gates remain required before merge.
- This native change is outside installed build 20. Group with pending PRs 389/394. No paid EAS build or paid model request is started.
- The one-line server instruction alignment is pending the next grouped API release before the new native build; do not create an isolated Vercel deployment for this small follow-up. API 394 already retired category-model calls.
- No owner acceptance/full V1 completion is inferred. M7 workstreams 3/7 advance; 1/3/4/5/6/7 ongoing, 2 code ready.
