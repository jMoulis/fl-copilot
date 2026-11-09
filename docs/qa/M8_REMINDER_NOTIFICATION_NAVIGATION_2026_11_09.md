# M8 — reminder notification navigation, 9 November 2026

## Finding and focused correction

Commercial-reminder and reminder-test responses always push a new root screen. An OS response replay or opening the notification while its destination is already visible therefore stacks the same operation/settings page. The previously accepted Copilot completion path already reuses its existing destination.

Reuse the installed Expo Router actions for those two existing reminder destinations: return with `dismissTo` when the root already contains the matching operation/week or settings page; otherwise use `navigate`. No extra deduplication state, queue, lookup, listener or retry is required. Keep local reminder/actor/store checks, clear-response handling, operation/week/revision parameters and the independent background synchronization. The operation screen retains its current-plan/revision warning for an older alert; opening a notification does not execute an operation.

Update notification-settings copy to acknowledge the owner-approved answer preview and describe availability without promising an unspecified future build. No new permission request, delivery channel, opt-in, reminder, server event, model call or business write.

## Verification and limits

Five mounted-provider regressions use the installed native StackRouter transition engine: repeated opening, an already-visible operation, an already-visible reminder-settings page opened by a test notification, and operation/settings destinations underneath a different detail page. All five fail against the prior push behavior. After the change the same target route key is retained and the root stack contains the original tabs plus one target screen.

**62 tests in seven suites pass, zero skips**, including scheduling/reconciliation, permission refusal, changed plans, account/store transitions, failed local lookup, rejected background synchronization, chat opening and token lifetime. SQLite/OS/network ports are controlled; router transitions use installed library code. No production reminder or test business record is created. Strict types, lint, formatting, iOS export, exact-head CI and native delivery are recorded separately.

This closes the reproduced stacking behavior in controlled navigation, not physical iPhone delivery or all T11. Chat completion remains owner-accepted. The current notification services cover chat completion and explicitly retained commercial-operation reminders; document-processing completion alerts are not implemented and remain an explicit T11 gap rather than being inferred from synchronized document statuses or silently added to the chat opt-in.

## Grouped iPhone recipe

Bundle this correction with PR477's original-retention protection. Use the existing notification-settings test button, “Tester un rappel dans une minute”, with iPhone permission already granted. Open its alert while the settings page is still the retained destination and verify that Back does not uncover a second copy of that page. An actual retained operation reminder should likewise reopen its one operation page and retain the current-plan warning when relevant. Do not create a fictitious production operation merely to exercise this route or repeat accepted chat/offline recipes.

Record exact build/source/Info.plist identity before asking for device acceptance. An export or EAS FINISHED status is not installation or acceptance. No new API release is needed for this mobile-only batch.
