# Journal — Repères du jour, 18 November 2026

## Approved scope

Owner approves the mockup and implementation (“Ok on y va”). One Journal entry
opens a dedicated page in its existing Stack, with the selected business date.
Eight entries, grouped into local context and market/news, reuse existing sheets.
“Contexte national” moves there as “Prix et conjoncture”. Compact weather stays
in Journal. “Analyser cette journée” remains after observations and notes with
its unchanged selected-date Copilot action. Build 76 functionality is accepted;
this does not reopen the national-news, INSEE or M0–M8 recipes.

## Implementation and acceptance criteria

- Route `/today/reperes` uses the existing SQLite-backed `useWeeklyContext`.
- Existing sheets accept custom entry rendering; data selection, archives, source
  links and explicit refresh stay in their existing components.
- Weather and calendar entries expose their respective parts of the same sheet.
  The original Journal weather entry retains its combined detail.
- Normal Back pops without replacing Journal; deep-link fallback passes the date.
- Missing sources, old dates and offline refresh errors keep entries accessible;
  no current facts fabricated for historical dates.
- No API, storage schema, sync contract, provider, agent or AI instruction change.

## Validation and release

Existing five context-component suites: 11 tests passed. New integrated native
rendering suite: all eight real sheets open/close and reopen, weather/calendar
source separation, archived-date week selection, retained-content error, Back,
direct-link fallback and existing explicit refresh (2 tests).

Structure, lint, workspace TypeScript and repository formatting passed. Full
local test run: 5,439 passed, 898 skipped and one 5-second timeout in the unchanged
API observability suite; its isolated rerun passed all 9 tests in 1.38 seconds
without code or timeout changes. Exact-head CI and release identities follow. A renderer test is not a physical iPhone gesture qualification.
Any native build is local on the Mac; no paid EAS cloud build. No API deployment
is needed for this mobile-only change. Device acceptance of this new navigation
remains distinct from the accepted build 76 functionality.

## Delivery

- PR 537 merged, feature head `4cbf7ea3c4647a77508bc48c93ad81350284d8e4`.
- Exact-head push 44242013687 and PR 44242042764 succeeded, including native
  exports and transactional MongoDB tests. Merged branch deleted.
- Source `aa94fcfbdd6d26a729807936612d2aa7fa8b0ad8`; master CI 44243325807 succeeded.
- Local Mac iOS production archive **0.1.0 (77)** compiled and verified: source,
  bundle/team, STORE signature, production configuration and new navigation
  bundle markers. SHA-256:
  `2bf7f65161cf56465bd2bf5694a8eac8affbe63e1663a1e4edaa9eab4899bd03`.
- Apple accepted the upload. The third status read confirms build 77 as `VALID`
  and `IN_BETA_TESTING`, not expired, on the existing private app. No public
  release or tester invitation. Owner acceptance is recorded below.
- Fifty cloud build records have identical IDs before/after; no paid cloud build.
- No API deployment. Existing PR 536 API remains in production.
- Private receipts: workspace `maintenance/journal-context-page-2026-11-18/`.

## Owner acceptance

After installing/testing the delivered build 77, the owner reports:
“Super ça fonctionne parfaitement”. The Repères du jour navigation increment
is functionally accepted and closed. This records the owner's overall feedback,
not an invented gesture-by-gesture test log. No further recipe or build is needed
without a reported regression. Previous accepted lots and explicit deferrals
remain unchanged.
