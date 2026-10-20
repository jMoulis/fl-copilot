# Native design fidelity — 20 October 2026

## Device feedback and reference

The owner installed/reviewed staging **0.1.0, native build 2**, EAS `dd32fb48-c423-4ab7-a444-fe0fb4e0de0e`, source `c8a16987ed6c558b20bd2f52fa761c9095a2982b`. His feedback is positive about the application but explicitly says the design is insufficiently faithful to the mockups. This is **not acceptance of L1–L6, workstream 7 or M8**.

The three boards in `../ux/FL_Copilot_Implementation_Specs_v1_1/assets/` were inspected against the components in that exact source. `../ux/AUDIT.md` remains authoritative: retain the visual direction and compact hierarchy, preserve the conversational chat and all operational workflows, and do not reproduce invented stock, hourly graphs, orders or causal uplift from the illustrative boards.

## First correction batch

- Darken the card/elevated surfaces and soften outlines consistently in native tokens and NativeWind. The navigation bar uses the canvas and the Copilot uses a sparkles icon.
- Primary screen headers lose the repeated brand eyebrow; common page gutters become 16 points. Detail/form screen headings retain the brand by default. All existing business states remain available.
- Today uses a sales hero followed by two side-by-side monetary cards, becoming a single column on narrow displays or enlarged text. Three real KPIs are retained; a fourth invented stock KPI is not added. Priority rows retain their facts, proposed action and incomplete-data state without the nested card structure. Explanations of freshness/J−7 remain in a disclosure; the visible disclosure label preserves the comparison basis.
- Analytics uses a compact segmented period control and period navigator. The amount, qualified comparison and daily/monthly chart belong to the same hero card. Bar baselines are aligned; zero, absent and partial observations remain distinct, with the full amount and date exposed on each accessible drill target. Detailed comparison provenance moves below the chart in an expandable section; incomplete coverage remains visible even when closed. No reference bars are invented where the repository exposes only current daily points.
- Category/contributor amounts use denser rows. Opening analytics and opening the product sheet remain separate actions. Detailed reading qualifications remain available in a disclosure.
- Catalogue search, filter and add actions share the header area. Quick category filters compose with all existing filters and search. Rows put nature/unit and sync state together. Pending/conflict/incomplete states remain visible, long labels can grow, and the list remains virtualized with its existing saved context. Approved cached product visuals remain the source of images; missing images use the existing neutral placeholder.
- Actions opens the existing calendar directly from its compact week heading instead of displaying the whole date form above the task list. No nested modal is introduced. Previous/next week, existing tasks and all preparation/import/settings links remain available.

This batch does not claim pixel identity, redesign the architecture or alter formulas, publications, Outbox commands, synchronization or private asset rules.

## Verification scope

A temporary local Expo web review mounted the **actual native presentational components** (`TodayContent`, `ExplorerContent`, `CatalogueList`) at 390×844 and 320×740. It did not use the unrelated HTML chat prototype as proof. Today used the existing migrated-SQLite `today-summary.test.ts` fixture output. Analytics used a fixed, period-filtered fixture including an available zero, an absent day and a partial day, calculated by the existing shared comparison engine. Product fixtures were isolated in memory. No fixture was published, synchronized or written to production; the temporary route/data were removed before native export.

Observed:

- Today: large sales amount, two monetary cards and compact priority rows render at phone width.
- Analytics: selecting the absent day shows **Indisponible**; selecting the available zero shows **0,00 €**. Back restores the week. The coverage control exposes and hides the full reference explanation. Bar baselines are common even for partial/missing days.
- Products: the initial six rows render compactly; Fruits plus “poire” produces one matching row and retains its pending state. The advanced filter sheet remains accessible and returns to the filtered list. At 320 points the document width equals the viewport (320), with no horizontal page overflow.
- The review tab, viewport override and owned local server were cleaned up. Screenshot/harness evidence is stored in the task artifact directory `artifacts/ux-fidelity-2026-10-20/`; these are component reviews using labelled test data, **not screenshots or acceptance of the installed iOS binary**.

Automated result: **1,371 tests passed / 7 skipped**, covering mobile repositories, synchronization/local state and the shared analytics engine (154 passing test files, one skipped). Repository lint, all ten TypeScript projects and clean iOS/Android export passed. Final exact-head push and PR CI evidence belongs to the PR.

## Remaining fidelity and acceptance work

Review the real native headers, safe areas, tab bar, text enlargement, keyboard, sheets and gestures with the device. The local web viewport cannot prove these. Complete the treatment of product details, task/execution views, secondary operational forms, approved imagery and category presentation. Decorative hero/product imagery is still a visual gap; no image generation, rights assumption or provider cost is introduced here. The chat stays conversational under the approved arbitration rather than copying the recommendation-card wall from the illustration.

The first correction is code ready after checks; it has not been delivered to the installed build. A new paid EAS build is reserved for a coherent acceptance batch. No API-only deployment can update these native screens. Do not mark V1/M8 complete from this record.
