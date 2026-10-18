# Agent brief

## Objective
Audit existing V0 and deliver a small, production-quality Analytics Explorer navigation slice, not a wholesale rewrite.

## Workflow
1. Read specs and inspect routes, navigation, state management, SQLite queries and UI components.
2. Produce `AUDIT.md` and a minimal change plan before modifying code.
3. Reuse existing infrastructure; propose replacements only with evidence.
4. Implement Week -> N-1 comparison -> Day drill-down -> Back first.
5. Validate on real iOS and Android builds, accessibility, offline, partial-data states.
6. Deliver `VALIDATION.md` with test results, screenshots and outstanding decisions.

Do not invent production data, metric formulas, hourly data or commercial calendars. Escalate unresolved policy decisions.


## Additional module (v1.1)
Read `09_VISUAL_ASSET_LIBRARY.md`. Audit existing catalog media support and plan as a separate, later workstream. Do not trigger image generation on data imports.
