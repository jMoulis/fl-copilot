# Comparison engine — business logic first

## Locked weekly and daily policy
Use ISO 8601 Monday–Sunday weeks. Week N-1 comparison aligns **same ISO week number in prior ISO week-year**. Day N-1 comparison aligns **same weekday in corresponding ISO week** of prior ISO week-year.

Example: 2026-W42 = Oct 12–18, 2026; 2025-W42 = Oct 13–19, 2025. Compare Monday to Monday, Saturday to Saturday; never blindly match same calendar date.

## Other granularities
- Month: default same civil month N-1, clearly labelled. Flag differences in weekday composition or trading days when material. A commercially normalized month requires a separate approved policy; do not silently invent one.
- Year: prior civil year with coverage qualification; do not claim exact weekday equivalence.
- In-progress period: compare only equivalent **completed and imported** trading days. Missing import != zero sales.

## Edge cases
- ISO year may differ from civil year near January 1.
- ISO week 53 sometimes has no N-1 counterpart: return `not_comparable`, do not substitute week 52 silently.
- Holiday shifts, promotions, closures, weather and unusual stockouts may require annotations, not speculative mathematical adjustments.
- Zero/missing baseline: no percent change, no infinity.
- Waste increases are adverse even if mathematically positive: semantic colors depend on KPI direction.

## Typed result
```ts
type ComparisonResult = {
 current:{periodId:string; value:number|null; coveredDays:string[]};
 baseline:{periodId:string; value:number|null; coveredDays:string[]};
 status:'comparable'|'partial'|'missing_baseline'|'not_comparable';
 absoluteDelta:number|null; percentDelta:number|null;
 reasonCodes:string[];
};
```

Never show a precise delta for incomparable coverage. A baseline with zero or missing value must yield `percentDelta: null`. For valid metrics use their approved KPI-specific comparison formula and sign semantics.
