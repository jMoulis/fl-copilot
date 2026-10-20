# Chat table gestures — 20 October 2026

## Device report and correction

The owner confirms that the previous image/chat stability correction works, but reports that analytical tables cannot scroll horizontally on iPhone. The native renderer already used a horizontal ScrollView. Its whole assistant message was also wrapped by the message-menu Pressable. Remove that ancestor press responder around assistant answers; retain the native copy/delete menu on paragraph text, table cells and the author label. User-message long presses and the visible copy action retain their existing behavior. Streaming text remains readable/selectable as before.

Constrain the horizontal viewport to the answer width; retain fixed, non-shrinking columns and an intrinsic-width table. Enable directional lock, cancellable content touches and nested scrolling, and show a light indicator against the dark canvas. Source taps keep the same validated local source sheet. No prompt, response contract, business formula, persistence, synchronization or dependency changes.

React Native references: https://reactnative.dev/docs/scrollview and https://reactnative.dev/docs/pressable . These explain the responder/scroll controls; they do not prove this device-specific diagnosis.

## Verification scope

A temporary route mounted the actual CopilotChatView/AssistantAnswer, including the enabled message-menu callback, a five-column table, a local citation and a draft. Test values were labelled as local QA data; no real business data or AI request was used.

The original web renderer was already horizontally scrollable: 782 px of content in a 354 px viewport at 390 px. Therefore the iPhone failure was **not reproduced in a browser**, and the ancestor responder is a targeted native-gesture correction, not a claimed proven cause on the device.

After explicit Metro restart/recompilation, the corrected components were checked at 320, 390 and 844 px. Last-column offsets were 498/428 px in 284/354 px viewports; the full page remained exactly 320/390 px wide. At 844 px the table fit without page overflow. A vertical gesture starting on the table moved the conversation to the top while retaining the horizontal offset. A typed draft survived both axes, resizing, opening the source sheet and closing it. The local source value was displayed correctly. Copy/delete controller tests and parser/streaming/history-scroll tests remain part of the targeted suite.

Screenshots and the disposable harness are in the task artifact directory `artifacts/chat-table-scroll-2026-10-20/`. The temporary route was removed, the owned server/tab were closed, the viewport override reset, and Expo's automatic local tsconfig rewrite restored before final checks/export. No QA route or fabricated business data ships.

## Delivery and remaining acceptance

This is a native-only correction for M7 workstream 7. Keep the grouped-release policy: no API deployment or paid EAS build for this isolated UI change. The already issued native build 3 does not include this correction. Deliver it in the next coherent native batch. Device acceptance must confirm horizontal drags starting on a table cell, continued vertical conversation scrolling, stationary long-press Copy/Delete, and source taps, with the keyboard open and closed. Native iOS and Android gesture acceptance remains open; a browser check is not a substitute.
