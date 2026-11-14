# Journal daily piloting — 14 November 2026

Owner approves the interactive proposal (“Ok très bien ça me va”), after choosing
private personal tasks alongside existing commercial tasks and optional reminders.
This ledger distinguishes implementation, automated verification, release and
physical iPhone acceptance. No owner task or installation is fabricated.

## Scope and reuse

The existing Journal gains an **À faire** list immediately after weather, with
three primary entries, expandable remaining entries and secondary completed /
cancelled entries. Personal items retain their planned date, optional Paris time,
actual status timestamps and account/store ownership. The native date selector,
bottom sheet, notification module and provider lifecycle are reused.

Commercial rows are deterministic proposals from the current canonical week plan
and its existing execution declarations. They open the exact current task through
the existing plan/editor, without creating a declaration. TODO, DONE, SKIPPED and
NOT_APPLICABLE remain distinct. A week-only task gains no invented deadline.

Personal task capture/edit/status changes commit with their Outbox command and
local history. Concurrent devices compare explicit current versions. An old form,
an in-flight cohort or a changed conflict review cannot overwrite a later edit.
Conflict choices retain history and use the canonical replayable command path.
No task marks a stockout resolved, alters a KPI or proves a physical installation.

## Contracts and compatibility

- Shared strict `personalTaskSchema`; stable UUID; owner/store identity and
  creation time immutable; positive revision and explicit completion/cancellation.
- SQLite migration 65: `personal_tasks`, `personal_task_history` and device-only
  `personal_task_reminders`. Mongo migration 62: `personalTasks` and
  `personalTaskHistory` scope/revision indexes.
- `PERSONAL_TASK_UPSERT` / `personal_task` uses existing push, processed-command
  transaction, private-record dispatch and incremental change feed. The private
  registry's historical `chatCollections` name does not expose tasks to the model.
- `personalTasks=true` independently opts into owner-filtered bootstrap/pull.
  Bootstrap carries `personalTasksOwnerId`; the client refuses missing/wrong
  ownership before adoption. Old clients receive no new task entity. Bootstrap
  refuses an oversized cohort above 5,000 instead of silently dropping history.
- Actor checks precede cached acknowledgement replay; local Outbox selection,
  failure counts and conflicts also retain private scope. No new public endpoint,
  AI tool, model call, recurring job or provider is added.

## Optional local reminders

The task and its date/time synchronize. Enabling a notification is explicitly
**sur cet appareil**; its OS handle, permission and preference stay local. Capture
is durable before requesting OS permission. Permission denial, elapsed time and
scheduler failure retain the task and a qualified reminder state.

The existing Paris wall-time helper is reused, with no commercial opening-hour
restriction. The spring gap is rejected; autumn's first occurrence is used with
a visible qualification for a reminder in that repeated hour. No reminder is
created for an untimed task. The existing 32 commercial slots plus at most 24
personal reminders reserve device scheduling capacity without deleting tasks.

Reconciliation is idempotent, checks current account and exact task/preference
state around asynchronous scheduling, and cancels changed/completed/cancelled
alerts. Logout uses existing private notification retirement. Foreground display
checks the current owned task. Opening an alert returns to the existing Journal
and the exact current private record; a stale tap does not mark it done or claim
the old version is current. An offline second device cannot immediately cancel
an alert it has independently enabled elsewhere.

## Verification and delivery

Implemented on `feat/journal-private-daily-tasks`. Automated checks and release
identities are recorded when completed; an interactive mockup approval does not
constitute native device acceptance.

Targeted tests exercise offline restart, atomic rollback on account change,
private Outbox/read isolation, ordered edits, delayed acknowledgements, real
two-device conflicts against an isolated Mongo replica set, replay and old-client
compatibility, reminder idempotency/denial/failure/cancellation, native capture,
status changes and notification destinations. Existing commercial writes and
private notification cases remain regression checks.

## Focused iPhone acceptance after delivery

1. Journal: add a personal task, edit it, mark it done and reopen it. Verify the
   selected date and original Journal position on sheet dismissal.
2. Set one future reminder and background the app. Open it and verify the exact
   task, then edit/cancel another scheduled reminder and verify no duplicate.
3. Open an existing commercial row and return without changing its declaration.
   No need to rebuild a preparation or redeclare an installed TG.

M0–M8 accepted cases and the deferred Atlas/PA/detailed-implantation/M9 scopes
remain unchanged. No V1-wide completion or scientific Journal qualification is
claimed by this task feature.
