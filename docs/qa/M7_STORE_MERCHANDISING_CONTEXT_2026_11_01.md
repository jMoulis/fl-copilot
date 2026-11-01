# Declared store merchandising context — 1 November 2026

## Scope

The existing store settings now hold optional active produce-TG count, implantation/family notes, habitual main circulation and named TG/island-face/other locations with active/inactive/unknown TG status, position, hot/intermediate/cold/unknown qualification and optional observation. A physical TG inventory does not establish produce capacity. Unknown heat is not cold; neither position nor sales silently classifies heat. TG1 being first encountered is not proof it is hot.

The native store editor keeps locations behind a disclosure and opens one location form at a time. Dirty-field protection and stale baseline checks cover the new fields. Existing settings history, atomic local Outbox, scoped Mongo settings/history and conflict comparison are reused; no new table, collection, provider, model tool or geometry store. Existing JSON payloads need no column/index migration. Helpers can read, while manager authority is checked in the editor and authenticated push route by both command type and entity type. Existing geography mutations preserve merchandising.

The `store_settings` tool returns the complete declared context with qualified version-bound evidence; the GPS point stays excluded. The existing PDF tool points to these settings for weekly strategy. Labels/notes remain untrusted source content, not instructions or permission to act. No full-context injection is added to the global prompt.

## Compatibility and evidence

- Bootstrap and pull advertise `storeMerchandising=true` only with store context. Legacy readers receive a projection without the new property. Modern bootstrap acknowledges support; the local adoption marker is saved atomically with its snapshot, including first adoption on an existing cursor. An old API response is refused before cursor/snapshot mutation.
- Capable push requests retain full results. Legacy acknowledgements, retries and conflicts project the field away, preserving original processed-command records. A writer omitting the field preserves the current local/remote value under exact revision checks; explicit null is the clear operation.
- A legacy snapshot received during an unsynchronized local edit is retained as actually received; it must not acquire local unacknowledged merchandising in its remote baseline. The local draft remains pending.
- Real disposable Mongo replica tests cover persistence, idempotent replay with different reader capabilities, unrelated legacy update, capable conflict, old/new bootstrap and pull, private-GPS exclusion, qualified Copilot read and explicit clear. The database is isolated under `/private/tmp`; no production data is touched.
- Real SQLite tests cover Outbox/history, offline reopen, preservation through geography edits/legacy acknowledgements and the unsynchronized remote-baseline distinction. Existing conflict and local tool runtime suites remain included.
- Mounted real settings screen covers empty defaults, declared count/circulation, named TG activity and optional heat, dirty state, local save during network failure, invalid-count input preservation and helper read-only state. Server route tests reject helper writes before the persistence service.
- Shared contracts reject duplicate location identities/names, non-TG activity and an active count below known active TG locations. API-client tests verify capability isolation. Normal local checks include lint/typecheck/tests, format, API bundle import and free iOS/Android export; transactional CI remains a separate gate.

## Acceptance limits

The Mac is locked, so native visual/gesture acceptance is pending. No API release, paid EAS build, actual model request or owner-store settings write is implied by automated tests. Build 21 predates this increment. Julien's declarations (two produce TGs, TG1 first, central aisle between two islands) are documented for the pilot, not hardcoded or falsely marked synchronized; TG2's exact position and all actual heat classifications remain unspecified.

These named commercial locations are not automatically bound to physical furniture/surface UUIDs. Detailed plan mapping and feasibility remain separate. Weekly plan adoption, redundant PDF-processing removal and broader merchandising-expertise acceptance remain open in the approved refactor.

After grouped compatible API/native delivery: Mon magasin → Mon rayon · merchandising; save count/circulation, add one named location and choose a heat qualification (or leave it unknown). Reopen offline, synchronize and verify on another authorized device; ask the Copilot to read the store context. Compare a concurrent edit and verify both full contexts. Check the old binary can still synchronize geography without erasing the declarations. A saved context must create no weekly plan, physical-layout change or execution.

Deployment order: release the compatible API before a capable native binary. Pre-feature API code has a strict settings parser and cannot be treated as a safe rollback after merchandising has been written; retain the new serialization/preservation compatibility when reverting other behaviour. Never delete the new context to make an old API parse it.

Local verification at PR preparation: 4,657 tests passed, 747 environment-dependent skips; a separate isolated replica run passed all four store-context integration cases (overlapping coverage, not added to the local total). API import/build, format, typecheck/lint and free iOS/Android exports passed. Exact-head push and PR CI remain independent merge gates.

Final review reproduced a focus-read race: a geography or merchandising keystroke and a previously started read could complete before the dirty ref refreshed at render, clearing the new input. Mark these edits dirty synchronously in their event handlers; mounted deferred-read tests cover both fields. Exact-head CI must rerun after this fix.
