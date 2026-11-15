# Weekly TG journey — native verification

## Scope and acceptance

The owner accepted the [weekly journey design](../ux/WEEKLY_TG_JOURNEY_2026_11_15.md).
Native acceptance covers week → selected TG → declaration sheet → cancellation,
then exact return to the originating week. Declaring an actual installation is
an explicit user action, not part of a read-only visual test.

## Significant regression coverage

- Existing week-overview tests retain real SQLite fixtures and check explicit
  week/placement routing, draft-only detail, deleted targets, returning/fallback,
  newer drafts with access to confirmed execution and legacy Journal/copilot
  links. A disappeared draft cannot select a confirmed plan implicitly. Opening
  these routes leaves the Outbox empty.
- The execution journey harness mounts the real controller, canonical checklist,
  task schema and actuals parser. It verifies opening/cancelling without a write,
  confirmation as the sole writer, the immediate save lock, optional values and
  dirty-close preservation, price/unit validation and conflicts. Unknown
  placement/task IDs expose no replacement TG or declaration action.
- Existing TG presentation cases retain compact/share-editing behavior and
  exercise card/detail actions and complete legends for very small zones.
- The repository's existing revision/copy/conflict checks remain authoritative;
  no second save path or repository implementation is introduced.

## Evidence and delivery boundaries

Local repository lint, ten-workspace typecheck, final mobile typecheck,
formatting and iOS Hermes export pass. Full local Vitest passes with four
workers: **5,377 passed / 897 skipped**, across 538 passing and 92 skipped
suites. Environment-gated skips are not claimed as executed database tests.
The last draft-link guard also passes the focused nine-case week overview.

An actual native XCTest on the already connected iPhone 17 Pro / Expo Go
passes the current-source read-only journey in 19.172 seconds. Native taps open
the TG, open the declaration and unfold the optional actuals; both start and end
are present, with no date or unit selected. The fixed confirmation remains
hittable while folded and unfolded, but is never pressed. X restores the detail;
an actual edge-back returns to the exact original stack, row frame and identical
week screenshot bytes. Six screenshots were inspected, and all captured app-file
hashes match the final source files. Only the local XCTest companion was built;
this does not qualify a standalone application binary or a real installation
declaration. Explicit save behavior is exercised by the controller harness.

Private logs and current-source native evidence are kept outside Git under
workspace `maintenance/weekly-tg-journey-2026-11-15/`. Source checks, actual native
navigation, CI/merge, signed local archive, Apple processing and owner acceptance
are separate gates. This source increment is not part of accepted build 68.
No API deployment or paid EAS cloud compilation is authorized by this document.
