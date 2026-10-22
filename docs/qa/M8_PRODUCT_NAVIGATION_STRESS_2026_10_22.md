# Product navigation retention and stress test — 22 October 2026

## Owner confirmation and reproduced cause

The owner confirms that Analytics retained a filter, did not see a recovery screen, and identifies progressively slower product editing/navigation as the primary issue. This replaces the initial data-loss hypothesis as the focus of the incident; no device/database reset or restoration is performed.

The installed Expo Router 57.0.24 emits NAVIGATE without `pop` for `router.navigate`. Its installed StackRouter reuses the current route or an explicit singular route, but does not unwind to an older index automatically in the unconfigured product Stack. The previous list → detail → editor → save → list path used REPLACE on save and NAVIGATE for return. That retained the previous detail, replaced the editor with another detail and appended a new list. The pure installed router retained **1,501 product-stack routes after 500 cycles**.

Hidden detail/list screens also kept `useVisualLibrary` observers and Outbox listeners active. That hook invalidated the shared metadata query on each change, including from off-screen instances. React Query can share an in-flight request, but sequential timer callbacks and retained observers still caused repeated reads and rendering. The mounted-hook baseline below measures this amplification rather than inferring it from route counts alone.

## Correction

- Explicit return-to-list and return-after-save use public `router.dismissTo`: reuse the retained screen/key or replace an isolated deep link when the destination is absent. The editor still waits until saving/dirty guards are clear. Custom callers retain their existing callbacks and unsaved-form protection remains in place.
- Explicit product returns from store-event/substitution forms use the same intent, avoiding duplicate root tab containers. The exact SDK reducer also verifies this root-stack pattern over 500 iterations.
- Visual metadata observers are enabled only while their screen is focused. Hidden screens unsubscribe from Outbox events. Focus revalidates the existing shared local cache, so missed edits are displayed when returning; cached content is not cleared.
- The existing product hooks are unchanged apart from equivalent relative imports for mounting them in tests. No new domain cache, migration, formula, sync protocol, prompt or runtime dependency is introduced. React test renderer is pinned to React 19.2.3 as a dev-only dependency.

## Reproducible harness

`product-navigation.stress.test.ts` combines the installed pure Expo StackRouter, actual React-mounted `useProductList`, `useProductEditor`, `useVisualLibrary` and `ProductPerformance` code, React Query and a private file-backed SQLite database. It runs the production save service and read repositories. Focus events, native presentation and session/sync contexts are controlled fixtures. SQLite uses the existing write coordinator and an independent connection per exclusive transaction, matching the application's connection ownership pattern. All statements/rows/writer transactions are counted.

The synthetic store contains 500 products, 500 leading-zero identifiers, 1,000 aliases, 7,000 product/day projections and 14 department days. A cycle opens detail, opens editor, saves one real local mutation, returns to the original detail, then returns to the original list. Pending Outbox notifications and refreshes are drained between phases using a controlled timer clock. Wall durations measure actual local React/SQLite work, not the fake timer interval.

Before/after comparison uses the same fixture and harness. Baseline is PR 316 source `d454067` (the first import fix is already present), with the prior navigation calls and unfocused visual-library behavior. Three regression cases fail before correction. Baseline runs 100 mounted edit cycles; corrected endurance runs 500. The corrected first 100 cycles are compared with baseline's 100, not its total 500 work. Data and logs are retained under the shared workspace's `artifacts/product-navigation-stress-2026-10-22/`.

## Measured results

| After 100 cycles                    | Before navigation fix | Corrected |
| ----------------------------------- | --------------------: | --------: |
| Product-stack routes retained       |                   301 |         1 |
| Visual-library Outbox subscriptions |                   301 |         1 |
| Visual-library query observers      |                   301 |         1 |
| Cumulative SQL statements           |               110,661 |     7,211 |
| Cumulative rows returned            |             7,983,800 |   608,700 |

SQL statements decrease **93.48%** at equal cycle count. Before correction, mean measured save-phase work rises from **61.6 ms** over cycles 1–20 to **624.6 ms** over cycles 81–100. Corrected means are **2.8 ms** and **2.7 ms** over the same windows, and **2.6 ms** over cycles 481–500. These are reproducible bench observations, not native latency promises or CI timing thresholds. Heap samples are not used as a memory guarantee because GC timing varies.

At cycle 500 corrected, one list route, one gallery subscription and one gallery observer remain. Unmounting releases all gallery subscriptions and writer transactions. The 500 commands remain PENDING in SQLite, the catalogue remains at 500 products, and their modified values are relayed through the returned detail/list/library states. Codes/aliases retain version 1 and historical projection counts are preserved. During the editor/save phase, hidden galleries perform zero visual-metadata reloads.

## When data loads in the corrected product flow

Counts below are the steady workload of this isolated bench, not the total of every application provider. They include bookkeeping/PRAGMA statements as well as SELECTs.

- Open detail: 21 statements. Read the product aggregate/conflict (4), current visual library (7), initial analytical presentation/latest-date (2), and the two existing analytical metric reads (8). Analytical snapshots still use the existing exclusive transaction contract; this change does not weaken consistency.
- Open editor: 4 statements for the selected product/codes/aliases/conflict. The hidden list/detail do not reload their visual metadata.
- Save: 17 statements including local validation/write/Outbox/recalculation enqueue and focused fiche refresh. No hidden-gallery reload.
- Return to retained detail: 19 statements; its analytical presentation state is retained rather than recreated.
- Return to retained list: 11 statements (catalogue/search identities/conflicts + one visual-library refresh). Returning still deliberately refreshes changed values; it does not accumulate another list.

Further optimization of analytical snapshots/full catalogue reads remains possible, but it is separate from the demonstrated cumulative leak. No speculative cache layer is added.

## Delivery and limits

Full local checks, formatting, native exports and both exact-head GitHub workflows are required. The fix needs a grouped native binary, installed over the existing app. The current native build 5 does not contain it. No API deploy is needed.

This is not a full rendered FlatList/native form or UIKit/Android gesture/FPS benchmark. The harness mounts the production loading hooks and analytics component while replacing native presentation, and exercises router state with the real SDK reducer. Background auth/network/upload/recalculation providers and the physical camera are not part of this isolated loop. Therefore receipt capture, tactile response, native SQLite bridge timing, animations, keyboard, unsaved-form gestures, other domains and the owner's real catalogue still require native acceptance. No production data, provider, environment file or system toolchain was modified. No whole-app performance guarantee or V1 completion follows from the bench.
