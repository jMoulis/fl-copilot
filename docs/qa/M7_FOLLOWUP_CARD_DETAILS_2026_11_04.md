# Compact Copilot follow-up cards — 4 November 2026

## User-facing change

Confirmed choice/task associations and declared realizations open as a compact summary. Keep action/task label, declared status, planned week for a task, known or unknown actual exposure details, and synchronization visible. Historical quotes, notes, version/declaration timestamps and withdrawal controls move behind **Voir les détails**. The expanded state is announced to accessibility services; all actions keep existing touch targets.

READY cards remain fully expanded with their before-confirmation facts and explicit checkbox. Their titles say “à confirmer”/“Relier”, never imply an unsaved declaration is already recorded. STALE/ERROR states keep explanations/recovery visible. Pending records retain a read-only refresh outside details so a compact card does not hide synchronization follow-up. Failed initial loads now also expose the existing retry on realization cards.

Opening/closing details cannot confirm or withdraw anything. Closing resets a checked withdrawal; successful writes return to the compact state. Withdrawals retain the existing explicit checkbox, version/freshness/actor guards, immutable snapshot and Outbox path. Read-only callers can inspect history but never see mutation controls. Original declaration time is not exposure time; compact summaries preserve actuals qualification. No API, schema, formula, repository writer, global instruction, new tool or provider change.

## Verification and native boundary

**32 tests across four files pass, zero skips**: eight mounted interactions backed by real SQLite, both existing repository suites and the sender-list editor. They verify READY confirmation, compact CONFIRMED/WITHDRAWN states, deliberate withdrawal, checkbox reset on collapse, original task/choice rows unchanged, no queued changes from disclosure, read-only history, pending refresh, unknown/known actuals and failed-load retry. Mobile strict types, targeted lint and formatting pass. React review checks bounded state, identity-scoped resets, accessible expansion/controls and no global synchronization subscription or read merely to expand.

The native release groups this increment with PR 433’s explicit sender addition/removal. API `3353993` remains compatible and is not redeployed for these mobile changes. Exact-head push/PR checks, merged-master checks, exact EAS source/profile/build identity and downloaded IPA verification precede availability. Mounted tests are not physical iPhone gesture/readability acceptance. No paid AI request, production business fixture, new installation or link confirmation is needed.

Focused phone check after the grouped build: inspect an already confirmed historical card, expand/reclose its details without activating withdrawal, then inspect the existing store sender list/editor. Do not repeat accepted source processing, plan installations or linked-choice creation. Workstreams 1/3/4/5 remain functionally closed; workstream 7 advances and stays open pending native UX validation.
