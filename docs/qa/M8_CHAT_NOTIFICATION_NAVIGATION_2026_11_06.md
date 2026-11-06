# M8 — one chat screen after a notification, 6 November 2026

## Reproduced defect and correction

The owner accepts the real reply excerpt in build37 notifications, but reports a second chat screen revealed by a native gesture after opening an alert. The existing completion handler used `router.push` even when the Copilote index was already active. A mounted-provider regression using the installed Expo Router stack reducer reproduces two index routes instead of one before correction.

Reuse the existing typed, locally authorized destination. While the root stack is on `(tabs)`, `navigate` selects the existing Copilote tab/index, forwarding the conversation ID without pushing a second chat page. From a root detail above the tabs, `dismissTo` returns to that tab container, forwarding the same nested destination; without an existing container it replaces the current route. The latest root state is retained in a ref so navigation changes do not reinstall notification listeners. No new navigator, global reset, data model, fetch or draft writer is added.

Owner/store/deletion checks, missing-result message sync, scope-change fences, response deduplication and ordinary commercial reminder destinations are retained. User drafts and conversation selection continue through the existing chat controller. Coverage labels are explicitly deferred to the UX review; the owner suggests moving their detail behind the information button into a bottom sheet.

## Host verification

- Four added mounted-provider regressions fail before correction: same-page successive notifications (two different conversations), selecting Copilote from another tab, returning from a root detail with or without an existing tab container.
- Installed Expo Router stack/tab reducers verify route count, stable route keys and destination parameters; navigation is dispatched through mocked native router ports. This is not a physical swipe test.
- 66 tests in six suites pass, zero skips: reminder provider, scoped chat destination, push provider, history window, conversation repository and history restoration.
- Ten-project strict typecheck, targeted ESLint, formatting and iOS Hermes export pass.

## Delivery and remaining acceptance

Native-only correction; the compatible API preview release remains unchanged. Exact-head GitHub push/PR gates, merge and grouped signed iPhone delivery are recorded separately. Host export and reducer tests do not establish physical notification delivery or gesture behavior.

On the new build: leave the app with a conversation open, tap its completion notification, then scroll/use the same gesture that revealed the duplicate. Repeat from Analyses and from a product detail. There should be one Copilote page, with the notified conversation selected. A saved draft should remain available when reopening its conversation. Keep the previous build37/API pair for rollback. Do not mark T11 or all M8 closed before device acceptance.
