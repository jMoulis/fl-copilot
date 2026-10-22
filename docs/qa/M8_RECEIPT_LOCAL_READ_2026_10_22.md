# Receipt list reads during synchronization — 22 October 2026

## Owner report and scope

After installing staging/internal iOS build 6 (source da2608a), the owner reports substantially better product navigation, 16 pending synchronization items and a waste list stuck at “Lecture des tickets…”. The pending-item breakdown has been requested; its contents are not accessible in the local device database from this workspace. Do not treat all 16 items as Outbox commands or attribute them to Inngest quota without evidence.

Read-only checks: Sentry fruits-et-legumes returned no issues last seen in the last 24 hours. The bounded Vercel 15-minute error/fatal query returned no entries. A separate bounded recent-log query returned successful authentication/email-status requests and Inngest callbacks; it does not establish the status of local commands or background analyses. No production mutations, database recovery, queue reset, replay or data deletion were performed.

## Reproduced cause and correction

The actual waste route skipped its SQLite list read whenever synchronization status was `syncing`. A status change to syncing also invalidated an already-running read through the focus-effect cleanup. Consequently initial loading could stay true with existing tickets kept invisible for the duration of synchronization.

The route now reads local tickets independently of network progress. A changed last successful sync still triggers a refresh. Returning to focus and explicit pull-to-refresh keep working; displayed content survives read errors. A pending read is shared across polling/manual refresh calls in the same focus generation instead of repeatedly overlapping queries and discarding previous results. Blur/account/store changes invalidate the result and do not share that read with another context.

Only the existing route's lifecycle is changed; equivalent relative imports allow mounting that real route in tests. No repository SQL, domain contract, analytics formula, migration, provider, source file, command or synchronization protocol is changed.

## Verification

Five regression tests fail against the previous lifecycle and pass after correction. A sixth checks account/store isolation. The harness mounts the actual WasteScreen route using React test renderer and controlled navigation/session/sync contexts plus a controlled repository port. It covers a sync that never resolves, starting sync during a pending read, retained content after failed refresh, slow-read polling/manual coalescing, blur/refocus and successful-sync refresh, and old-account completion after scope change. Native view rendering and the physical SQLite bridge are outside this harness; existing repository tests cover SQLite mapping.

The 16 pending items remain an independent diagnostic and are not declared fixed by this change. The next release must group any confirmed synchronization correction with this route fix rather than starting another paid build prematurely. Full local checks and both exact-head GitHub workflows precede merge. No API redeployment is required for the route fix. Native acceptance remains pending.
