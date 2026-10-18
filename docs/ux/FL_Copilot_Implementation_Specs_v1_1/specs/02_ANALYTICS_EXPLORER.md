# Analytics Explorer UX

## Main layout
Header; Day / Week / Month / Year segmented control; previous arrow + period label + next arrow; KPI hero with value, delta, comparison reference and coverage; interactive chart; category/product breakdown; optional contextual filters.

## Interaction rules
- Arrows shift exactly one active unit.
- Tap period label opens picker suited to granularity: day calendar, ISO week list with Monday–Sunday dates, month grid, year list.
- Year bar -> month. Month chart day bar -> day; month also has explicit ISO week chips for week drill. Week day bar -> day. Back restores exact prior period, filters and scroll.
- Switching granularity directly anchors to the selected date and clears drill history; keep metric and product filters.
- A week is identified by `(isoWeekYear, isoWeekNumber)`; not calendar year plus a guessed week.
- Cross-month ISO weeks show their complete Monday–Sunday date ranges.
- Day view must NOT invent hourly charts if only daily totals are available; show a daily KPI and category/product breakdown instead.

## State model
```ts
type Period =
  | {kind:'day'; date:string}
  | {kind:'week'; isoWeekYear:number; isoWeek:number}
  | {kind:'month'; year:number; month:number}
  | {kind:'year'; year:number};
type AnalyticsState = {
  period:Period; metricId:string; categoryId?:string;
  familyId?:string; productId?:string;
  drillHistory:Array<{period:Period; scrollOffset?:number}>;
};
```

## Simple by default
Do not expose ISO/calendar/commercial comparison modes as routine user choices. The engine decides the appropriate baseline. Show only a short label such as `vs week 42 · 2025`, with exact dates on detail tap.
