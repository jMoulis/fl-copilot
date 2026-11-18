# Analyses — charts, category distribution and navigation, 18 November 2026

## Owner scope

The owner accepts the monthly chart mockup and asks to remove the Casse PA tab
and “Comprendre cette répartition”, make category filters smaller, add a pie-like
chart and match the mockup bottom navigation. The supplied screenshot identifies
the existing full-width category cards and filled active navigation pill.
Build 77 remains owner-accepted. The next requested workstream is daily purchase
price upload, after this UI delivery; no PA source format has yet been supplied.

## Implementation

- Whole-period chart, no horizontal scrolling; pointer selection and accessible
  previous/next controls show exact values before explicit scoped detail opening.
- Shared bucket aggregation, signed values, clipped dates, missing/zero and
  SUM/AVERAGE semantics preserved. Optional chartDate belongs only to persisted
  device-local presentation state; Back restores it through existing history.
- Three regular monetary selector choices. Old purchase-cost citations still
  retain their actual measure; no business data or shared KPI removed.
- Compact wrapping category filters retain their information sheets. A donut
  uses all available category amounts in scope, independent of contributor page
  or sorting. Null categories stay unknown; signed totals and averages have an
  explicit non-pie fallback. Shared decimal arithmetic calculates the shares.
- Native SVG rendering uses Expo SDK 57's recommended react-native-svg 15.15.4:
  https://docs.expo.dev/versions/latest/sdk/svg/ . No charting framework/provider.
- Continuous green bottom bar, outline icons, accent-colored active label/icon;
  existing Expo Router Stacks, hidden routes, safe area and font scaling retained.

## Verification boundaries

A local React Native Web harness renders the actual chart, category-distribution
and tab layout components with test data and stubbed authentication/navigation/
icons. Visual inspection at 390 and 320 px confirms whole-month fit, legible
selection, donut and wrapping categories. Selecting the next value leaves the
preview in place; the detail action emits the selected date. This is not a
physical iPhone or full-app navigation test. Harness lives outside the repository
under `maintenance/analytics-polish-2026-11-18/preview/`.

Native renderer/shared tests cover selection-before-drill, clipped SUM/AVERAGE,
missing versus zero, signed geometry, restored selected bucket, category shares
and filters, plus retained old purchase-cost citation semantics.

Local `pnpm check` passes: structure, lint, strict typecheck and 547 test files /
5,446 tests. 92 integration files / 898 tests remain environment-skipped locally;
the unchanged GitHub workflow runs its configured database checks. Full repository
formatting and Expo web export pass. The navigation renderer mock now supplies
the safe-area insets used by the real bottom bar.

Exact source and delivery identities to be recorded after completion.
The release is mobile-only: no API deployment. Build locally on the Mac; no paid
EAS cloud compilation. New iPhone acceptance remains pending.
