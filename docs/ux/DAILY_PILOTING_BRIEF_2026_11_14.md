# Daily piloting — scoped brief, 14 November 2026

Status: **SCOPED, NOT IMPLEMENTED**. Owner authorizes roadmap consolidation and
the definition of the next daily-piloting increment. Owner explicitly chooses
free reminders in addition to existing commercial tasks, private to their
account, with optional notification reminders. Screen changes follow a mockup
review, using the approved Journal design and existing system font.

## Purpose

Answer “What do I need to do for my department today?” from the Journal, with a
short actionable list and quick capture. Retain the current weather/context,
observations and Ma semaine access. Planning, observations and execution keep
their own meanings.

## Audited existing code

- `apps/mobile/src/journal/journal-screen.tsx`: selected date/week, local field
  observations, notes, weather/context sheets and draft-analysis access. No daily
  mixed task list currently exists.
- `packages/domain/src/commercial-execution-task.ts`: PRINT_SIGNAGE and INSTALL_TG,
  tied to a specific plan/revision/checksum. Statuses TODO, DONE, SKIPPED and
  NOT_APPLICABLE; declarations and actual exposure dates are distinct.
- `apps/mobile/src/commercial/execution-repository.ts` and
  `execution-checklist-view.tsx`: canonical local transaction/Outbox, source-aware
  task listing and explicit declaration controls.
- `apps/mobile/src/commercial/actions-view.ts`: existing user/store-private local
  view state. Preserve the originating week/date/filter/scroll on return.
- `packages/domain/src/commercial-reminder.ts`: reminder identity is bound to a
  plan and operation. Reuse the native notification adapter/lifecycle, rather than
  giving a personal reminder fictional commercial identities or inheriting its
  unrelated commercial hour limits.
- Journal notes are dated statements with withdrawal/history, without TODO or
  completion semantics. Existing private Copilot records provide patterns for
  owner/store authorization, offline persistence and incremental private sync.

## First proposed experience

1. Journal keeps its day selector and compact weather. A calm **À faire** block
   presents at most three primary rows, followed by **Tout voir** and **Ajouter**.
   Examples for the mockup are fictional, never seeded into the real account.
2. Show the origin discreetly: **Personnel** or **Plan de la semaine**. The list
   may combine both sources; commercial tasks retain their existing shared-store
   visibility while personal entries remain owner/store-private.
3. **Ajouter un pense-bête** opens one sheet: free text, date prefilled from the
   selected Journal day, optional time, optional **Me rappeler**. No compulsory
   product, category, commercial plan or AI processing.
4. Personal task detail supports edit, mark done/reopen, change date/time and
   cancellation with retained history. The proposed first statuses are **À faire**,
   **Fait**, **Annulé**. These labels still require visual review.
5. Commercial rows open their existing declaration/detail, preserving source and
   revision checks. A saved plan or accepted recommendation is not an installation.
6. Group dated personal entries by the selected day. On today's view, make overdue
   open entries identifiable, without automatically changing their scheduled date.
   Week-only commercial tasks remain labelled **Cette semaine**; the user's usual
   Tuesday habit does not assign a fictional exact deadline.
7. Completed/cancelled entries stay secondary and inspectable. Empty state is
   **Aucune tâche enregistrée**, not a claim that the department has no work.

Proposed order: overdue personal items, timed items, then week-only commercial
items; retain their source deadlines where one exists. This is presentation,
not a new economic-impact or urgency scoring model. The mockup must show the
mixed list, empty state, add/detail sheet and return to the selected Journal day.

## Personal data and offline contract to implement

Personal task data belong to the authenticated owner within one store. The same
account may retrieve them on another authorized device; another store user must
not receive them in bootstrap, pull, command acknowledgements or model context.
No account transfer or cross-store write is implied.

The minimal logical record needs stable UUID, owner/store scope, text, planned
date, optional local time, status, real completion/cancellation timestamps,
version and creation/update history. Planned date is not the date of execution.
Implement dedicated task semantics through the canonical SQLite transaction and
Outbox, then incremental sync with replay/conflict tests. The exact contracts,
migrations, serializers and conflict policy belong to the implementation step;
this brief does not create a table, collection, command or generic repair layer.

The mixed list is a read projection over the two existing/dedicated sources, not
a second task datastore. Preserve commercial writes and plan identities. Closing
a task does not close a stockout, certify freshness or modify KPI observations.
User correction/history must survive app closure, connection loss and retries.

## Optional reminders

Proposed first implementation: a reminder is explicitly enabled **sur cet appareil**,
using local iOS notifications. Task text/date/time synchronize privately; OS
permission and the local notification handle remain device-local. This avoids
implicitly enabling the same alert on every connected device. Other devices
receive the task through normal sync and reconcile reminders they previously
enabled; immediate cancellation on an offline other device is not guaranteed.

Use the store's Europe/Paris time, including explicit DST resolution. No arbitrary
opening-hour restriction. A reminder needs a future precise time; a past-dated
task can still be saved. Denied permission or scheduling failure leaves the task
saved with a clear reminder state. Editing/rescheduling, done/cancelled state and
sign-out cancel or reconcile the corresponding local notification idempotently.
Opening a notification opens the exact owned task; it never marks it done.

Recurrence and delegation are outside the first increment. Reminder wording,
time control and device-local label are to be reviewed in the mockup.

## Copilot and delivery boundary

No additional agent, routine model call or automatic task creation is needed for
the first increment. This is operational capture and navigation. A later scoped
private read may expose planned/completed tasks when useful; task plans must not
be presented as field observations. No new Copilot writer is part of this brief.

The current Journal and descriptive engine remain accepted. This increment does
not reopen M0–M8 or the Atlas/M9/PA/implantation reserves. No paid build, API
activation, production task, notification or source-data mutation is authorized
merely by recording this brief.

## Acceptance for implementation

- Find a current commercial task and a personal reminder from the same Journal
  list, without losing source, selected day or return position.
- Capture/edit a personal reminder offline, reopen the app and synchronize once;
  retrieve the same UUID on the owner's second device, with no foreign-owner leak.
- Mark done/reopen/cancel explicitly; retain the real timestamps/history and
  preserve later edits against delayed acknowledgements. Resolve concurrent edits.
- Permission denial, past time and scheduling failure preserve the saved task;
  rescheduling/cancellation do not duplicate alerts. Notification opens the exact
  task and handles a withdrawn, inaccessible or already completed entry honestly.
- Commercial declaration and stale-plan behavior remain those of the existing
  canonical service. No task progress implies sales uplift or physical exposure.

The next deliverable is a focused interactive mockup, followed by shared contracts
and implementation once the screen flow has been reviewed.
