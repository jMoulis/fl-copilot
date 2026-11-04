# M7 — selected chart readability, 4 November 2026

## Reproduced defect and bounded change

A mounted real AnswerChart with a long product label and a PARTIAL point reproduces a selected summary that shows the amount without its partial qualification. A generic warning elsewhere in the chart does not identify the selected value. The regression assertion fails before correction and passes after it. Reuse one point-label formatter in the visible summary and accessibility labels, preserving null/zero/negative values and recorded units.

Point buttons now expose selected state and an underline in addition to color. Axis-label space and full-column targets grow with system font scale; the full selected product label remains readable above the scroll area. The existing source action has a minimum 44-point target. No KPI arithmetic, interpolation, remote reads, persistence writer, extra chart library or provider changes. Horizontal scrolling and the original persisted-source sheet remain.

## Verification and delivery boundary

**14 tests across two files pass, zero skips**. Mounted tests cover both bar/line charts, zero/missing/negative values, partial selected values, changing selection, the long full label, doubled font-scale layout, source activation and restoration from a persisted answer without fetching. Strict mobile types, targeted lint and formatting are checked before merge. These are component/geometry assertions, not physical VoiceOver, large-text or horizontal-gesture acceptance.

The Mac is locked and automatic unlock fails; no simulator review is claimed. This mobile-only increment is outside accepted build 30 and is reserved for a subsequent coherent native release. No API deployment or isolated paid build is required. Physical check when that build is available: open an existing chart, select a partial point if present, open its source, and inspect enlarged text; no new advice/choice/installation is required. The two-product comparison and build-30 disclosure/editor cases remain accepted and must not be reopened without a regression.
