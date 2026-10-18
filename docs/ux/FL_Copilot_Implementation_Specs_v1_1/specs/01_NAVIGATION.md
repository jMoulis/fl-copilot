# Native navigation contract

## Structure
Use Expo Router as the single navigation authority. Bottom tabs: Today, Analytics, Products, Copilot, Actions. Each tab owns an independent Stack; restore its previous route and relevant local state when switching tabs.

## Pattern decision matrix
| User intent | Pattern |
|---|---|
| Switch domain | Bottom tab |
| Open product, category, recommendation detail | Stack screen |
| Change analytics granularity or drill into time | State transition within Analytics |
| Pick date / advanced filters | Contextual bottom sheet |
| Select metric | Segmented control or short popover |
| Camera receipt capture and review | Full-screen modal flow |
| Destructive or consequential action | Explicit confirmation |

No side drawer as main navigation. No bottom-right floating drawer as a substitute for a route. One intent must have one consistent interaction pattern.

## Back precedence
1. Dismiss keyboard/popover.
2. Dismiss modal/sheet (confirm before discarding edits).
3. Unwind explicit Analytics drill history.
4. Pop current tab Stack.
5. Use platform root behavior.

## Gestures
- iOS left-edge swipe: native Stack back, not a global gesture over charts.
- Android system Back: semantic precedence above.
- Chart horizontal gestures: chart-only pan/selection.
- Period swipe: optional only in clearly bounded date header/calendar region, with arrow alternatives.
- Sheet downward swipe: safe dismiss only; unsaved edits require confirmation.
- All gestures have visible tap alternatives.

Preserve selected metric, period, category/product filters, chart drill history and scroll position across tab switches. Use serializable route parameters for deep-linkable state; transient UI state remains local.
