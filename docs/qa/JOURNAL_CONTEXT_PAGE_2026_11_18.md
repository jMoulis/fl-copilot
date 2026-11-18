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
