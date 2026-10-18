# Delivery plan

**Phase 0 — Audit (no code changes):** map existing Expo Router structure, state stores, sheets, date libraries, SQLite repositories, chart interactions, and existing KPI specs. Deliver `AUDIT.md` and risks.

**Phase 1 — Shared foundation:** navigation conventions, typed Period identifiers, ISO week utilities, comparison result types, semantic theme tokens, reusable period navigator and picker.

**Phase 2 — Vertical slice:** Week KPI -> automatic 2025 ISO-week baseline -> weekday chart -> Day drill-down -> Back. Use real local repositories and explicit missing-data states.

**Phase 3 — Extend:** Month, Year, period picker, category/product filters, cross-tab restoration, chart accessibility.

**Phase 4 — Validate:** unit tests for calendar edges; integration tests for navigation and SQLite; iOS/Android gesture tests; screenshots and manual shop-floor usability check.

**Exit criteria:** acceptance checklist passes; no regressions to offline-first flows; unresolved commercial-month policy explicitly documented for owner approval.
