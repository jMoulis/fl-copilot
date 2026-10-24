# M8 — reminder settings feedback and context, 24 October 2026

## Reproduction and boundary

Four mounted tests fail on the original settings route: verification failure produces an unhandled rejection without an alert; a retained button from a previous owner/store still invokes refresh; an old permission request still saves activation after the owner changes; and an old store's delayed list is displayed in the new context. These are controlled native-host reproductions, not a diagnosis of an owner's Sentry event.

The initial time-range suspicion was disproved: `reminderInstant` already restricts the hour to 06:00–21:59. Its implementation and tests are unchanged. No new scheduling policy is inferred from this audit.

## Correction

The existing route binds reads, feedback and actions to its current owner/store/database/device and focused lifetime. Returning to the same scope preserves local content; old scope content is hidden before replacement reads complete. Sequenced reads reject late snapshots. Focus cleanup removes subscriptions and invalidates retained callbacks. Equivalent renewed session objects and ordinary rerenders do not trigger new reads.

The existing permission, preference, single-reminder deactivation, test and verification actions share a local lock and explicit failure feedback. A failed verification retains displayed settings and releases the button. Permission is still requested only after the user's activation/test action. Native calls recheck context after awaits; a test that finishes after leaving the screen cancels only its own unique notification identifier. Successful registration is not proof of actual OS delivery.

`ReminderRepository.setEnabled/save` accept the caller's optional context check, invoked before transaction acquisition, inside the transaction and after local writes. A closing form therefore rolls back its intent and history together. The existing operation editor remains a separate caller; this increment does not claim a full lifecycle audit of that form. No remote reminder entity, Outbox command, schema, migration, provider, AI tool, global prompt or new dependency is introduced.

## Evidence and remaining acceptance

- Ten mounted settings-route cases cover the four reproductions, double activation, equivalent session renewal, focus closure, retained rows during another store's read, late native test cleanup, denied permission and forty ordinary rerenders with one subscription/read pair.
- Four new real SQLite cases cover queued and mid-transaction cancellation for preferences/reminders, rollback of local history and no business Outbox/plan mutation. Existing persistence/restart and reminder runtime tests remain included.
- Targeted suite: **33 tests / five files pass**. Full local checks pass **4,492 / 727 environment-gated skips**, all ten strict TypeScript projects, lint/structure/format and API build/import. Both exact-final-head CI gates, including native exports, must pass before merge.

Current API **379**, source `c3e55b4`, is delivered on `dpl_FNXW5Kwo5hSJLuHvMkoPiemtM3nY`; both exact-head CI and master pass **5,199 / 6**. Staged/public health/Mongo and unauthenticated private-route rejection passed. These probes and the bounded six-record clean initial log window do not establish live-model or owner acceptance.

These reminder changes are **after iOS build 16**, whose source remains `e43dc85`. They require a future substantial grouped native release; no isolated paid EAS build or API deployment is needed. Physical iOS/Android permission, background delivery, cancellation and screen behavior remain open. Other M7/M8 and full V1 requirements remain in scope; seven states stay **1/3/4/5/6/7 in progress; 2 code ready**.
