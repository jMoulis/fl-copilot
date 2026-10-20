# Product detail overview — 20 October 2026

## Scope and retained behavior

M7 workstream 7, UX lots L5/L6 and the existing Explorer. The supplied product-detail reference places the image and business reading before catalogue maintenance. The native detail now follows that hierarchy: approved cached image or a compact neutral placeholder, product name/category/nature/unit and sync state, contextual figures, shared chart, then expandable reference data. Product edit, conflict resolution, image source/recovery, identifiers/aliases, substitutes, observations and Need Unit/relationship views remain reachable. Image editing uses the existing guarded selection/capture/Outbox functions; this lot relocates the entry control without replacing that pipeline.

No stock tab, hourly curve, invented stock, generated product photograph, unqualified margin percentage or supplier order is copied from the illustrative reference. The two summary cards show net sales and margin in euros from local canonical data. Sales, margin, waste at selling price and qualified purchase-cost waste use the same ExplorerRepository and shared calculations. Missing values remain unavailable, observed zero remains zero and explicit daily averages are labelled as averages. A zero reference may still show the engine's absolute euro difference when a percentage is undefined.

## Context and offline behavior

Explorer → product carries the validated period, metric and explicit comparison; the product is the only filter retained for that detail. Product → Explorer and chart drill use the same navigation/period functions, including explicit ranges, ISO weeks and mean/sum semantics. No callback, actor/store authority or arbitrary route is accepted from a selection. Invalid/foreign product links preserve the local selection and show a notice.

The existing app_metadata presentation repository now supports a validated product-specific key, scoped by store/owner/product. The main Explorer key remains unchanged. Period/metric/chart offset survive file-backed restart without writing a business Outbox command; one product or user cannot read another presentation context. Opening a detail without a saved or explicit context follows the Explorer's latest-known-business-date default and labels the actual period, rather than silently calling it today.

The detail reads SQLite. It refreshes on focus, completed ordinary synchronization or an explicit reread; background activity keeps already displayed amounts with an updating/error notice. Changing period never relabels old figures as the newly selected period. The mounted reader is keyed by account/store/product, and stale async reads are ignored. Existing write serialization governs the bounded Explorer transactions. No new KPI engine, API route, provider call, timer, agent, business migration or synchronization entity is introduced.

## Verification

**1,537 tests passed / 7 skipped** across the mobile and analytics packages (163 passing files and one skipped). This includes file-backed restart/context isolation, exact product values across detail/Explorer links, zero/missing days, category change without rewriting historical amounts, day/week/month/year/explicit-range links, ISO year boundary/drill-back and a zero-reference display regression. The existing visual mutation, recovery, hashing, original preservation and write-serialization suites remain included. Strict types, lint/format/structure and local iOS/Android Hermes exports are recorded with the final branch checks; exact-head push and PR CI remain mandatory before merge.

A disposable route mounted the real ProductVisualPanel, ProductPerformanceView and shared ExplorerTrendChart at 390/320 px with clearly labelled fake data/ports. It exercised metric changes, zero-day and missing-day drill requests, a stale image-selection error, all-missing values and horizontal scroll. At 320 px the chart exposed 354 px within a 258 px viewport and scrolled from 0 to 96 px; page width stayed 320 px. Missing amounts showed “Indisponible / Sans donnée” without a fake 0,00. The image-selection failure preserved the page and its data. The placeholder was compacted after reviewing the first render; summary cards retain aligned values and dynamic wrapping.

Harness, fixture, screenshots and logs are retained in task artifacts. The route, fake data and Expo's incidental tsconfig rewrite are removed before final checks/export. This is a component/browser review and real SQLite evidence, not installed-phone acceptance. The real image picker, approval/save flow, approved-photo appearance, safe areas/tab bar, dynamic type, VoiceOver/TalkBack and iOS/Android gestures remain part of native acceptance. No new photo was created, uploaded or generated, and no system or environment file was modified.

## Delivery gate

This mobile-only increment does not itself require an API deployment. It joins the next coherent native acceptance batch, including the table gesture correction PR 291. The previous delivered API and iOS build 3 remain distinct from this code. All seven M7 workstreams and the eleven UX lots retain their existing criteria; this advances workstream 7 without declaring V1/M8 or the complete product-detail/native experience accepted.
