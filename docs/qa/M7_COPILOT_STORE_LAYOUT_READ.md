# M7 — Copilot reads the shared physical store plan

Workstream **6**, PR 270. Depends on the canonical plan/sync, native editor and footprint preflight from PRs 266–269. Read-only server capability; no new agent, native module, migration, database, model or credentials.

## Behavior

The existing authenticated conversation factory registers `store_layout` on the same ToolLoopAgent catalogue. It inherits SDK-native deferred discovery, read deduplication, byte/call/time budgets, streaming activity and source rendering. The installed SDK docs/source were checked (AI SDK 7.0.130; current registry patch 7.0.143 in the same major); no dependency upgrade or provider/model change is required.

- `REFERENCE` returns the exact adopted revision, even if the store has a newer saved draft. `DRAFT` explicitly inspects an active save/restore; discarded drafts do not reactivate. An absent synchronized plan/reference is not an empty measured store and does not exclude local unsynchronized edits.
- Start with a null target and cursor. The page lists at most 20 furniture records, room measurements, bounded assembly context, own-surface counts/kinds, selected/head revision metadata and the provisional geometry summary. It does not send the entire canonical snapshot to the model.
- Exact assembly → its fixed elements; exact furniture → its independent surfaces and associated mobiles; exact surface → its qualified details and owner reference. Subsequent pages pin the exact selected revision and verify that the cursor belongs to this selection. Change → `STALE`; unknown/foreign target → no records. The model supplies neither store scope nor a Mongo query.
- All measurements keep UNKNOWN/REFERENCE/DECLARED/MEASURED qualifications; zero coordinates stay known. The geometry engine checks the whole canonical inventory, while the conversational report returns ten prioritized relevant issues with explicit full counts/truncation. Its verdict remains limited to recorded footprints/clearance.
- The server loads exact store-scoped head/history documents, validates identities and reference pointers and rechecks the head after a historical lookup. Missing historical reference or concurrent change fails safely. Store/actor metadata needed for storage validation remains server-private; formatted output excludes `updatedBy`.
- Server-owned French evidence uses the selected physical revision/version. Ordinary source links show those values and limits. The tool does not adopt/save/move anything, generate an image, infer stock/capacity, allocate products or turn an adopted plan into proof of execution. The older flat `implantation_scenario` remains a distinct hypothetical calculator.

Routine commercial recommendations should reuse recorded furniture and keep its position fixed. This read does not add physical write authority or automatically memorize a measurement from an information form.

## Verification

**16 additional local tests** cover reference/draft/discard/absence distinctions, optional mobiles and independent surfaces, exact drilldown, stable pinned pagination, invalid cursor/foreign IDs, strict non-query inputs, zero/unknown qualifications, citation rendering, concurrent head changes, missing history and immutable-reference contradictions. Six cases exercise the actual installed SDK with simulated transport: ready, no reference, foreign/tampered private snapshot, byte budget and disabled capability. The model never receives raw storage snapshots or actor IDs.

Full structure/lint/typecheck/unit suite: **2 083 passed**, 486 environment-dependent cases skipped locally. **Nine real transactional Mongo cases** pass on a disposable database, including two new reads proving adopted reference versus newer mobile draft, repeated reads across chat context, foreign-target isolation and no creation/mutation on absence. Existing synchronization/refusal cases remain covered. Formatting and API compilation are required; no paid provider call, EAS build or production deployment is initiated.

## Limits and delivery

This lot is code-ready, not delivered/accepted in a real chat. API delivery will make this source tool available to compatible existing chat clients through ordinary citations; no native change is needed solely for this read. Grouped physical-plan delivery still requires a compatible API before the SQLite-49 binary. Real store reference creation/sync, response wording, target selection and cross-chat reuse await grouped pilot acceptance.

Physical mutation previews/confirmation, targeted forms that persist physical measurements, fixed/TG structural edits, native refusal repair and allocation/schematic/illustration linkage remain open. Physical reads are not yet a replayable recommendation fact dependency: the existing provenance mechanism marks such answers incompletely verifiable, rather than claiming freshness. Source revision IDs are retained for the subsequent scenario/linking work. No full feasibility, regulatory or execution claim is made.
