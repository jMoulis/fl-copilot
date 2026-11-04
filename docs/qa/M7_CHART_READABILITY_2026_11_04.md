# M7 — selected chart readability, 4 November 2026

## Reproduced defect and bounded change

A mounted real AnswerChart with a long product label and a PARTIAL point reproduces a selected summary that shows the amount without its partial qualification. A generic warning elsewhere in the chart does not identify the selected value. The regression assertion fails before correction and passes after it. Reuse one point-label formatter in the visible summary and accessibility labels, preserving null/zero/negative values and recorded units.

Point buttons now expose selected state and an underline in addition to color. Axis-label space and full-column targets grow with system font scale; the full selected product label remains readable above the scroll area. The existing source action has a minimum 44-point target. No KPI arithmetic, interpolation, remote reads, persistence writer, extra chart library or provider changes. Horizontal scrolling and the original persisted-source sheet remain.

## Verification and delivery boundary

**14 tests across two files pass, zero skips**. Mounted tests cover both bar/line charts, zero/missing/negative values, partial selected values, changing selection, the long full label, doubled font-scale layout, source activation and restoration from a persisted answer without fetching. Strict mobile types, targeted lint and formatting are checked before merge. These are component/geometry assertions, not physical VoiceOver, large-text or horizontal-gesture acceptance.

The Mac is locked and automatic unlock fails; no simulator review is claimed. This mobile-only increment is outside accepted build 30 and is reserved for a subsequent coherent native release. No API deployment or isolated paid build is required. Physical check when that build is available: open an existing chart, select a partial point if present, open its source, and inspect enlarged text; no new advice/choice/installation is required. The two-product comparison and build-30 disclosure/editor cases remain accepted and must not be reopened without a regression.

## Grouped delivery and scoped owner acceptance

PR 436 and PR 437 are delivered in staging iOS `0.1.0/build 31`, source `1f7783339469ce39001607ca0fac8c2cd56a1b10`, [EAS artifact](https://expo.dev/accounts/julesmoulis/projects/fruits-vegetables-copilot/builds/dc8d5d7e-a4a4-47d3-9de9-769ba71413e9). Both exact-head push/PR checks pass, as does final master run `41846466038`; branches are deleted. The downloaded IPA verifies `com.flcopilot.mobile`, build 31, 15,811,374 bytes, SHA-256 `92589a69ba557283e01e7a6e134a224f2a413610ba6a8480dee8ea0cf14658b2`. API `3353993` stays unchanged.

The owner confirms the chat-chart/source recipe works, then explicitly locates the existing Analyses return button: “Ok oui pardon, je viens de voir le bouton. 👍 On peut continuer”. This closes the supplied week → day → return and chat-chart/source phone checks. The earlier return-button question was resolved without a code change. Do not repeat these recipes without a regression. No physical negative-data fixture, exhaustive enlarged-text/VoiceOver audit or independently inspected installed-phone identity is inferred. Workstream 7 remains open for its remaining scope; this does not reopen accepted workstreams 1/3/4/5.
