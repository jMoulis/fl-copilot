# Fruits & Vegetables Copilot — UX Implementation Contract v1.0

English Markdown specifications for the React Native / Expo implementation agent.

Read in order: `00_AGENT_BRIEF`, `01_NAVIGATION`, `02_ANALYTICS_EXPLORER`, `03_COMPARISON_ENGINE`, `04_DESIGN_SYSTEM`, `05_SCREEN_CONTRACTS`, `06_OFFLINE_DATA`, `07_ACCEPTANCE_TESTS`, `08_DELIVERY_PLAN` (all under `specs/`).

**Locked decisions:** native Expo app, SQLite offline-first, Dark Premium, five tabs (Today, Analytics, Products, Copilot, Actions), independent stacks, native back gestures, analytics Day/Week/Month/Year, period arrows, contextual date picker, drill-down, restored context, business-default comparisons, ISO week-to-week N-1 matching.

**Priority:** existing validated product/KPI/ingestion specifications govern metric calculations; these documents govern UX and navigation. Flag conflicts rather than silently overriding them.

**Images:** `assets/` contains three conceptual boards. They are not pixel-perfect designs, nor sources of true KPI values. Written interaction rules take precedence.

## v1.1 addition — Visual Asset Library

Read `specs/09_VISUAL_ASSET_LIBRARY.md` for persistent product imagery, matching/reuse, licensed sourcing, optional AI generation, review, offline cache and acceptance tests. This is an additive module: **do not delay the Analytics Explorer vertical slice** to build it.
