# M7 — link the reviewed allocation to the commercial preparation

Workstream **6**, PR 273, following the immutable private proposal and native schematic in PR 272. The user story is: open the proposal in chat → compare the current weekly draft → explicitly save locally → synchronize the same draft → separately approve the commercial plan → restore that allocation and its original physical revision on another device.

## Scope and canonical data

The existing `CommercialWeekPreparation` carries an optional nullable `physicalAllocation` snapshot. Its existing JSON payload, history, Outbox command, canonical Mongo collection and CAS policy remain authoritative. A validated plan already embeds its preparation and therefore preserves the snapshot in its immutable plan revision. No new table, collection, storage service, migration or model-side mutation is introduced.

- Only an authorized manager can confirm the private source card. Exact persisted content, owner/store, active conversation and parent reply are verified locally. Completion is recorded with the draft/history/Outbox in one exclusive SQLite transaction. Replaying that card after restart does not create another command or approval.
- Before/after comparison preserves existing notes, commercial TG placements and selected offers. Only absent canonical retained offer references are added. An offer already selected at another version requires a separate explicit refresh. Assortment products do not become promotions; physical TG count is not converted into commercial capacity.
- New/replaced allocations are rederived with the shared deterministic logic against the adopted physical revision and exact product/offer versions. A changed source, invalid ownership or known blocking geometry refuses the save. Missing unsynchronized remote dependencies remain retryable. Mongo checks use the same transaction/session as the canonical write, with sequential session operations.
- A note edit may retain an older allocation, but commercial approval always rechecks its sources locally and remotely. A changed reference/product/offer prevents approval without erasing history. The allocation's state remains a proposal snapshot, not an assertion of commercial approval or field execution.
- The preparation and approved plan expose the same schematic and original source actions. Missing local history is unverifiable, not proof of deletion; the map never silently substitutes today's reference. The preparation opens the selected Monday, including a past/future proposal, rather than redirecting to the current week.
- Explicit removal sets `physicalAllocation: null` and takes effect only when saving the draft. Removing a link does not delete a private proposal, physical plan, original document or approved plan revision. Conflict summaries include the allocation targets and labels.

## Client compatibility

Push/bootstrap/pull negotiate `physicalAllocations` independently. Compatible native clients request it and record adoption, triggering rehydration after a binary upgrade. Old wire projections omit only this optional field from preparation, plan and plan revision; the stored canonical snapshot and processed-command replay remain complete. An old write that would implicitly erase an existing allocation is rejected with a client-update explanation.

The existing preparation-preview, plan-validation and conflict callbacks require `x-copilot-layout-preparation: 1` when their canonical basis carries this field. Existing model preparation edits preserve it; it is not a model patch argument. Older clients can continue reading their existing shapes. An immutable local plan revision previously received through legacy projection can hydrate this one field only when the remainder exactly matches the original projection; any other history rewrite remains forbidden.

## Evidence

- **15 new local cases**: four shared model/compatibility cases, nine actual SQLite controller/repository cases and two API-client capability cases. Cover exact version/scope, preserved notes/TGs, no fabricated promotions, approval dependency checks, role/private-card rejection, stale preparation/reference/product, cancellation, atomic rollback, file-backed restart, replay, explicit unlink and one-way history hydration.
- **Four real transactional Mongo cases**, on a disposable uniquely named database, cover actual SQLite/Outbox push/ACK, separate commercial approval and second-device bootstrap; dependency pending/retry and source change; legacy bootstrap/pull/ACK and unmodified full replay; stale-reference readiness and actual approval refusal. Production business data is not mutated; the test database is dropped.
- Full local checks: **2,153 passed**, 496 environment-dependent cases skipped without Mongo configuration; structure, lint and strict TypeScript pass. The four cases above were run separately with transactions enabled. API bundle/import and iOS/Android JavaScript exports pass. CI reruns the full repository against a disposable Mongo replica set before merge.
- Compiled production RN components at **390 × 844**, in a temporary local web shell: opening/scrolling the existing sheet, explicit confirmation, historical completed version with current-draft action, visible refusal beside the comparison, refresh and close. No console warnings/errors observed. The shell supplies fixture presentation state; actual persistence and server checks are proven by the separate SQLite/Mongo tests. All temporary routes/fixture files are removed before commit.

Screenshots: [comparison](../progress/assets/m7-store-plan-preparation-link.jpg), [recorded draft version](../progress/assets/m7-store-plan-preparation-saved.jpg), [refusal](../progress/assets/m7-store-plan-preparation-refusal.jpg).

## Delivery and remaining acceptance

Code ready after checks; not delivered to the installed iPhone. No paid EAS build, real model/image request or production deployment. Compatible API must precede the grouped native release. In the next grouped pilot, verify offline confirmation/restart, sync/second-device restoration, source change between review and approval, explicit removal, and reopening the correct historical week on the physical phone.

Workstream 6 remains **in progress**: linked illustration/provider/cost handling, missing physical constraints, structural fixed/TG inventory edits, direct manipulation/repair and measured field acceptance remain open. General recommendation freshness and decision/execution/result tracking are not declared complete by this source check. All seven workstreams retain their existing states.
