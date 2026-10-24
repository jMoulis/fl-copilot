# Chat message actions — 24 October 2026

## Observed gap and scope

The approved UX roadmap requires a visible alternative to gesture shortcuts. In the actual chat view, deletion of a user or assistant message was reachable only through long press. Copy already had a visible button. This increment adds a labelled 48 × 48 minimum `•••` button to the existing message footer, opening the same native Copy/Delete/Cancel menu. Long press remains available. The host still owns the deletion confirmation and the canonical local writer/Outbox; opening or cancelling the menu does not delete anything.

No message-wide responder wraps assistant tables. Attachment-only messages keep a delete/cancel menu without an empty copy option. The action is absent during generation or when the host provides no deletion handler, matching the existing gesture availability. No new command, model instruction, permission, database model or synchronization policy is introduced.

## Verification and limits

Five mounted-view cases use the real chat view, native Markdown table renderer and message-menu function, with native host surfaces mocked. Three fail against the unchanged view because the visible entry is absent; all five pass after the correction. They verify user/assistant actions and deferred deletion, attachment-only cancellation, generation/handler gates, and a horizontal table without an ancestor Pressable. With the existing menu and scroll tests: **9 passing tests across 3 files**. The local full check passes structure, lint, ten strict TypeScript projects and **4,341 tests / 717 environment skips**; final exact-head push/PR CI remains required. These checks are not a physical VoiceOver/TalkBack or swipe acceptance test.

The current grouped iOS build 15 has frozen source `1c3ab72` and does **not** contain this later correction. No isolated paid build is requested. At the next substantive native acceptance, check the visible menu with VoiceOver/TalkBack, cancel deletion, retain horizontal table scrolling and confirm a genuinely intended deletion through the existing confirmation screen. Conversation swipe alternatives and full accessibility acceptance remain separate open UX work.

Seven M7 states remain **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This is an incremental UX/accessibility correction, not acceptance of the full chat or V1.
