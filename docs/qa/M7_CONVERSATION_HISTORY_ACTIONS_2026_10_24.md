# Conversation history actions — 24 October 2026

## Observed gaps and behavior

Conversation deletion was available only by swiping a history row. Add a visible labelled 48-point delete control while retaining the native swipe and the existing confirmation wording. Bound long titles to two visual lines, retaining the complete accessibility label and compact creation date/time. The gesture-only duplicate is hidden from the accessibility tree; the visible equivalent remains available. No new business action, model instruction, permission, database model or remote contract is introduced.

The native confirmation is bound to the current controller/database context, owner/store/conversation, visibility and screen focus. Leaving that context aborts its pending action; a retained callback cannot delete a different conversation or reset a newer review's state. Duplicate confirmation is coalesced and errors remain local, generic and French.

The canonical controller forwards an optional cancellation signal to the existing repository deletion. That repository checks it before entering SQLite, after waiting for the write transaction, after reads, after saving the aggregate/Outbox and before its transaction callback completes. The same existing atomic writer retains immutable messages and archives the conversation, clearing only its draft/pending turns on an accepted deletion. Cancellation rolls those changes back. It does not undo an already committed, legitimately confirmed deletion or claim a remote acknowledgement.

The host distinguishes failure to delete from failure to re-read the list after a successful deletion. The latter reports that deletion is recorded and offers an explicit local re-read. Stale list failures cannot overwrite a newer read. Background synchronization is requested separately and its rejection does not become a false deletion failure.

## Evidence and limits

- **Four before-fix failures / one passing control**, using real migrated Node SQLite, the real controller and canonical repository. The unchanged implementation ignored cancellation before submission, in the controller queue, before transaction entry and after the aggregate/Outbox write. All five cases now pass, preserving exact snapshots of conversation, messages, draft, pending turns and Outbox on cancellation. The positive case verifies one command, retained immutable messages and idempotent logical deletion.
- **Eleven mounted native-view cases** exercise the real row and confirmation callbacks: visible alternative, swipe, cancellation, context/identity/visibility/unmount, blur/refocus, delayed failures, duplicate decisions, retry and ordinary rerenders. Host surfaces/navigation focus are controlled; these are not physical gestures or VoiceOver/TalkBack acceptance.
- With existing history and conflict coverage: **66 targeted tests across four files**. Local structure, lint, ten strict TypeScript projects and **4,357 tests / 717 environment skips** pass; exact-final-head push and PR CI remain required.
- The actual row and application components were inspected through an isolated local Expo web route at **320 × 740** and **390 × 844**. Page width equals viewport width, visible delete targets measure 48 × 48, long titles retain full labels and the hidden duplicate is absent from the accessibility tree. Screenshots were visually inspected in the tool; no saved screenshot artifact or physical-device proof is claimed. All data was explicitly labelled simulation; the route had no API, SQLite or business writer. The temporary route/layout are archived outside Git, removed before checks; the owned server/tab are closed, viewport and automatic tsconfig rewrite restored.

React review: the row component is stable outside its host, lifetime dependencies are explicit, state is context-bound, private callbacks are cancelled on closure, and no SQL subscription or model layer is added per row. History remains read through its existing bounded local repository.

## Delivery

This correction is later than the frozen build-15 source `1c3ab72`; it requires future grouped native delivery. No isolated paid EAS build or API deployment is requested. Physical iOS/Android swipe, screen-reader and large-font acceptance remain open.

Seven M7 states remain **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This advances private action safety and UX/M8; it does not close full chat parity, native acceptance or V1.
