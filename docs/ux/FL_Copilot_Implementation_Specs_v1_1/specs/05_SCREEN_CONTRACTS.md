# Main screen contracts

**Today:** KPI overview, exceptions, prioritized actions. KPI tap deep-links to Analytics with metric and period preselected.

**Analytics:** contract in `02_ANALYTICS_EXPLORER.md`; preserve context across tab switches and drill-back.

**Products:** searchable categories, family, SKU detail, substitutions; details are Stack screens.

**Copilot:** recommendations with evidence, time window and explicit action. Link to supporting Analytics without losing Copilot state. Never auto-execute an action just because a recommendation is displayed.

**Actions:** task execution with clear completion and confirmation for consequential actions. Gesture shortcuts need visible alternatives.

**Waste receipt capture:** full-screen camera -> extracted lines -> correction -> explicit save. Offline save to SQLite and sync outbox.

Each screen supports empty, loading, offline, stale, partial, error and success states. Do not show missing data as zero.
