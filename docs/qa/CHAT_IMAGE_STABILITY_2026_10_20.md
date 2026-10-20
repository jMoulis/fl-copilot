# Chat and product-image stability — 20 October 2026

## Observed incidents

The owner reports that changing a product image crashes the installed staging application (0.1.0, native build 2, source c8a1698). Sentry issue **FRUITS-ET-LEGUMES-7** records a fatal `NativeEventEmitter` error at `nativeVisualFileStorage.capture`, `visual-file-storage.ts:111`. Metro's namespace import of `react-native` enumerates legacy getters, including `PushNotificationIOS`, whose native module is absent. This is an import bug, not a requirement to change CocoaPods or the Mac toolchain.

Vercel's most recent observed chat turn (20 October, 03:55:06–03:56:22 UTC) returned HTTP 200 after about 75 seconds with `COPILOT_AI_INPUT_INVALID`; Sentry **FRUITS-ET-LEGUMES-API-5** records the fallback. The database connector did not grant access to the last conversation text, so this record does not claim that the actual user message was read. Independently reproduced: a supported 20-product analytical query returns 241 source facts. Both the post-generation validation and the message builder incorrectly reapplied the initial context's 100-fact limit. The service-only correction was insufficient: an integration test failed at the message builder until that second gate was corrected.

## Correction and invariants

- Product capture, store-photo intake and original-photo restoration lazily load a small image-size bridge with a named React Native `Image` import. They no longer dynamically import the React Native namespace. A scoped lint rule prevents reintroducing that expression.
- The initial request retains its 100-fact limit. A completed read has a bound of 241 facts; the existing five-call budget yields at most 1,205 tool facts, plus the original 100. Existing byte/call budgets and all source/figure validation remain active.
- Completed facts merge by stable identity through generation and message persistence. Equal facts deduplicate; contradictory facts or destinations fail safely. Unknown citations, invalid values and excessive pools remain rejected. No facts are silently sliced and no new model instruction or provider is introduced.
- No business data, formula, publication, user decision, Outbox or synchronization policy changes. No production business records are changed by tests.

## Verification and delivery

Regression coverage exercises the unsupported native getter, strict initial/completed bounds, invalid and contradictory facts, and an actual isolated Mongo analytical query with 20 products and current/reference sales, margin and waste. The transactional turn test persists the answer and replays once without another provider call or changes to canonical business observations. AI generation is mocked; no paid model request is used as test evidence.

Repository checks and exact-head push/PR checks are recorded in the release artifact after execution. A staged API release with health/authentication smoke tests can establish deployment health, not the quality of a live authenticated dialogue. The native correction must be delivered in a new grouped standalone build; no API deployment can change the installed image-capture code.

Device acceptance remains open: install over the previous application, change a product image, reopen it and inspect retention; attach a store photo; repeat the failed analytical question, check streaming and follow its sources. Do not uninstall the app to test this fix. The UX feedback remains open, including the approved design-fidelity batch already merged in PR 289. Full V1/M8 is not accepted by this correction.
