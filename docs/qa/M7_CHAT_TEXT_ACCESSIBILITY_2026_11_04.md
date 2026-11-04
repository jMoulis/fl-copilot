# M7 — native chat text semantics, 4 November 2026

## Reproduction and bounded correction

In the current-source iPhone 16e / iOS 26.3.1 simulator, the existing saved memory reply exposes “Copilote” and every ordinary assistant paragraph as a link. These nodes have a long-press menu handler, but no source navigation. The native accessibility tree reproduces the incorrect semantics without a paid model request or fabricated conversation.

Declare the author and Markdown table cells as text, and Markdown prose as text or headings. Leave actual nested source spans as links. No extra wrapper, responder, hook, query, model instruction, schema or dependency. Copy/delete buttons and existing menu confirmation remain; the native horizontal table has no enclosing whole-message press responder.

## Actual native verification

Use the existing Expo Go 57.0.9 installation and retained SQLite database. The old server on port 8081 points at another checkout and serves code supporting schema 12; the device already has schema 62. This is a development-server mismatch, not permission to downgrade, clear or reinstall the database. The current repository runs on an independent local port 8082 in Metro CI mode (no watcher), with the existing production API. No new runtime/Watchman/toolchain is installed and the old server is untouched. Expo Go's floating development control is outside the shipped app UI.

The current source opens the retained database and existing conversations. Before/after native accessibility trees show the same author and ordinary paragraphs changing from `link` to `text`. Long-pressing the author opens Copier/Supprimer/Annuler; cancel leaves the message intact. In another saved conversation, prose and table values are text while actual Source spans remain separate links with native link-count hints. Opening one of those links shows its existing Source sheet, and Fermer returns to the same conversation.

The same review opens Today and Actions, catalogue search → product detail → retained search, and Analytics → filters → close without changing selection. It does not reconfirm those business numbers or previously accepted TGs. No message is sent, deleted or memorized; no import, plan choice or execution is explicitly changed. No new AI prompt or generation test is submitted. Existing background synchronization/recovery may resume previously requested work and is not independently metered.

## Automated validation

**22 tests across four files pass**, including an interaction through the real chat/answer renderer: plain text/headings, long-press menu without deletion, real source-link opening, existing non-wrapped horizontal table, source validation and chart behavior. All ten TypeScript projects, targeted lint and formatting pass. React review confirms no added effect, subscription, remote read or render-time side effect.

Local evidence is retained outside Git in `artifacts/2026-11-04-chat-text-accessibility/`: native before/after accessibility trees, screenshots of the retained answer/source and targeted check logs. These are owner-private local artifacts, not synthetic production data or public PR attachments.

## Delivery boundary

Mobile-only correction, awaiting grouped native delivery after exact-head checks and merge. Do not redeploy the API or create a paid binary solely for this small semantic correction. Build 32 remains the owner-accepted PNG/caption baseline and does not contain this later patch. The simulator running current JavaScript is not the downloaded EAS binary or a physical iPhone acceptance.

No full VoiceOver traversal, Dynamic Type, Android, OS recovery or multi-device certification is claimed. Workstream 7 advances; closed workstreams 1/3/4/5 stay closed, numerical counter-promotion and deeper measured implantation retain owner-deferred scope. Existing image, chart and new-discussion memory recipes stay closed.
