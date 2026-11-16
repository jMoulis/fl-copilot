# Native sheet reopening correction — 16 November 2026

The owner reports build 71 stops opening sheets after a close and cuts the weekly TG explanation. No newer repository change was found. The component now removes its native Host after actual dismissal, retains outgoing content until that callback and recreates the presenter for a later opening. Closed panels do not keep native presenters in the hierarchy. Existing dirty/busy guards and queued native picker completion are unchanged.

Bound the fixed header to two lines (full accessibility label retained), and let the flex body shrink to its available height. This prevents a long heading from consuming the reading area. Business text is preserved.

Local validation: 25 component tests pass, including three close/dismiss/unmount/reopen cycles and queued completion once. Mobile strict TypeScript and targeted lint pass. Actual XCTest on the existing iPhone 17 Pro Expo Go simulator passed three weather/personal-task alternations without app restart or saves. A separate native journey opened the existing week of 9 November, its first TG and its explanation; body height exceeded 100 points, scrolling and close worked. Before/after captures were visually inspected and the final counter-promotion paragraph was readable. Initial test setup failures (wrong route/button selector) are excluded from acceptance.

Private test logs: workspace maintenance and /tmp/sequential-sheet-native-test-final.log, /tmp/week-reason-native-plan.log. These tests do not establish the production-only cause, nor replace owner acceptance of the next TestFlight binary. No schema, sync, API, AI or paid cloud build change.
