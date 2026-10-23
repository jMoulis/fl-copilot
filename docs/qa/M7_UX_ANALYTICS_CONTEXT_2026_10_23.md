# Visible analytical context — 23 October 2026

## Problem and behavior

A selected product could make Analytics appear empty while the filter was only mentioned in small text. The metric selector also followed the chart; the purchase-cost waste measure opened from Today had no matching selected option.

Active filters now occupy a labelled, editable scope strip before the result. The clear action reuses canonical scope navigation: current date range, metric, comparison, aggregation and source basis are retained; the previous frame remains available through Back. An explicit observed-product source says “Tous les produits”, rather than claiming to turn into an official department total. The original chat citation is untouched.

The four existing monetary measures (sales, margin, sale-valued waste, purchase-cost waste) are selected before the result/chart. A wholly empty series does not render an empty plot. Known zero values retain their value and plot. Filtered-empty guidance offers the visible scope action; absence is never converted to zero.

Products uses the same active filter-button treatment. Search can be cleared independently of category/nature/state, and filters can be reset while preserving a literal leading-zero identifier. No product, observation, Outbox command, shared formula or remote contract is modified.

## Automated evidence

- Twenty-five targeted tests pass across five files.
- Six mounted Explorer cases cover filter visibility before amounts arrive, direct filter opening, source-range preservation and exact Back, all monetary choices including purchase-cost waste, missing-versus-zero plots and calendar-scope guidance.
- Two mounted catalogue cases preserve either search or classification/sync-state filters when clearing the other.
- A real migrated, on-disk SQLite scenario saves the cleared view, closes/reopens the database, reads the official department total (77 EUR, deliberately distinct from the 40 EUR product subtotal), then restores the exact product selection and its 15 EUR. Original offsets return and no Outbox command is created.
- Existing scope, source-link, period, sorting and repository tests remain part of the targeted run.

## Visual and React review

Production presentational components were compiled for local web review at 390×844 and 320×740 with explicit local test data and no API or business writes. Observed: filtered unavailable → full fixture total 586 EUR → purchase-cost waste 12 EUR → Back to the original unavailable product. A recorded 0 EUR retains its chart. The filter sheet opens from the visible control. Browser error-log query returned no errors during this isolated review.

At 320 points, page scroll width equals viewport width (320); each monetary radio target is 70×60 points. Text wraps rather than clipping, and the scope reset action wraps below its label when necessary. Web observations do not prove native touch, dynamic type, VoiceOver/TalkBack, authentication or synchronization. The existing graph retains its bounded horizontal scrolling. Temporary review route/root were removed and the owned local server stopped before final checks; their source and observation record are saved in the shared workspace under `artifacts/analytics-context-2026-10-23`. Screenshots were inspected in the conversation; no saved screenshot path is claimed.

The React review found no new effects, subscriptions, timers, remote requests or list-loading paths. Existing memoization, scope validation and persistence remain authoritative. The active icon flag is optional; ordinary controls retain their behavior.

## Release limits

Full local checks, exact-head push/PR CI and merge must be recorded before delivery. This is native UI code, not a new installed binary. No API deployment or paid EAS build is started for this PR. Group with PR 328 and remaining coherent UX work for native acceptance. Chantiers M7 1/3/4/5/6/7 remain in progress; 2 remains code ready. The complete V1 objective and all M8 gates remain open.
