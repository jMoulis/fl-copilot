# Acceptance tests

## Navigation
- [ ] Five tabs maintain independent Stacks and context.
- [ ] iOS swipe-back and Android Back respect modal -> drill -> Stack precedence.
- [ ] Unsaved form cannot be dismissed silently.
- [ ] Chart horizontal gestures never trigger global Back.
- [ ] Gestures have accessible visible alternatives.

## Date explorer
- [ ] Day/Week/Month/Year control works from any anchor.
- [ ] Previous/Next advances exactly one period.
- [ ] Contextual date picker matches granularity.
- [ ] Year 2026 -> October -> week chip -> day -> Back restores exact context.
- [ ] Cross-month and year-boundary ISO weeks show complete date ranges.
- [ ] Switching tabs preserves selected period and filters.
- [ ] Day view with daily-only source never shows fabricated hourly values.

## Comparison engine
- [ ] 2026-W42 compares with 2025-W42, weekdays aligned.
- [ ] 2026-W42 Thursday maps to 2025-W42 Thursday.
- [ ] ISO year rollover and week 53 with missing baseline handled.
- [ ] Partial weeks compare only equivalent completed imported days.
- [ ] Missing or zero baseline never produces fabricated percent change.
- [ ] Waste delta colors follow metric semantics.
- [ ] Monthly comparison displays calendar-month basis without pretending to be weekday aligned.

## Offline and accessibility
- [ ] All navigation and cached analyses work in airplane mode.
- [ ] Pending sync is visible but does not block exploration.
- [ ] Missing import distinguished from zero.
- [ ] VoiceOver/TalkBack can access dates, chart values and actions.
- [ ] Touch targets, text scaling and reduced motion validated on device.
