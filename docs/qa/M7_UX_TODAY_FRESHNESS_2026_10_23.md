# Today: current local figures and qualified partial values

## Behavior

The Today focus reader previously depended only on pending/conflict/error counts. A successful pull with unchanged counters could leave old figures on screen. Conversely, intermediate counter updates during synchronization could repeatedly restart the relatively expensive daily summary read.

The same existing focus lifecycle now observes the last successful synchronization and coalesces counter changes while synchronization runs. A displayed store snapshot remains available until the pipeline settles, then the repository is read again. An initial visit or different-store visit still reads SQLite during synchronization; network completion is never a prerequisite for displaying existing local data. Hidden tabs do not gain a reader or subscription. Existing offline error retention and deliberate refresh remain available.

Today cards label a known partial amount directly as **Cumul partiel**, including known zero. A partial comparison is explicitly qualified and does not receive a favourable/adverse colour. Missing amounts remain unavailable; no calculation, comparison period, source, observation or official KPI is changed. Accessibility labels include the amount, partial qualification and comparison before describing the existing Analytics navigation. Secondary metric cards use the existing compact appearance on ordinary-width screens and stack at narrow widths or enlarged system text.

## Evidence and limits

- Six mounted hook cases cover 101 counter renders during an active sync with no extra repository read, one refresh on settle, a pull whose counters remain unchanged and whose intermediate sync status is not rendered, initial cached SQLite lookup during sync, offline failure/retry, hidden-tab return and a late former-store result.
- Three mounted production-component cases cover partial known zero, readable qualification, neutral comparison tone, missing versus complete amount, precise metric/day navigation and stacked large-text layout. These tests retain the actual comparison engine and link parser.
- The hook tests isolate scheduling with a repository-method spy; they do **not** simulate 100 physical SQLite writes or prove network synchronization. Existing on-disk Today repository tests separately exercise local daily queries and J−7 comparisons. The earlier product-navigation stress suite remains the evidence for repeated physical edits/navigation.
- The actual presentational components were compiled and inspected locally at 390×844 and 320×740 with explicitly labelled synthetic fixtures, no authentication/API/database writer. At 320 points, page scroll width equalled viewport width; all three metric targets measured 288 points wide and at least 140 points high. Partial and missing values were readable. Browser error-log query returned no errors.
- Screenshots were inspected in the conversation; no saved screenshot file is claimed. The temporary root/review route source is retained outside the repository under `artifacts/today-reading-2026-10-23`, and both temporary routes were removed before checks. The owned Metro process was stopped. Its automatic tsconfig rewrite was reverted. Metro reported an optional React Native DevTools installation error; the web bundle and observed components rendered successfully, and no manual toolchain installation was performed.
- React review: no additional effect, timer, global subscription, network request, migration or business write. The current-snapshot ref is used only by the existing focus reader; revision coalescing does not turn missing values into zero.
- Local full suite: **3,247 passed / 635 environment-gated skipped**; all ten TypeScript projects, lint, formatting, structure and API bundle/import pass. Fresh iOS and Android Hermes exports pass with the temporary QA route absent. Transactional Mongo tests still require the real replica-set CI environment; local skips are not passes.

## Delivery

Full checks and exact-head push/PR CI must pass before merge. This mobile-only change will join a future substantive native release; no API deployment or paid EAS build is required for this increment. It is not included in the already completed build 12. Native dynamic type, VoiceOver/TalkBack, real sync interruption and complete five-domain UX acceptance remain open.

Seven M7 workstreams retain their scope: actions/conflicts, documents, expertise, recommendations, implantation and UX/validation remain in progress; counter-promotion remains code ready pending real acceptance. This closes neither M7 nor the full V1/M8 goal.
