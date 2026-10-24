# Copilot — physical-plan conflict comparison, 24 October 2026

## Covered gap

The canonical plan comparison already existed in the store and synchronization screens (PR 354), but the conversational `store_conflict_review` input stopped at capability 5. A native resolver was not proof of chat parity. This increment connects that existing policy and writer to the existing conversational comparison, rather than adding a second plan resolver or a new model tool.

Capability **6** adds `STORE_LAYOUT` with `entityId: null`; the authenticated store selects its own plan. The model receives only typed revision/reference/action metadata and a fingerprint of the complete canonical plan. Furniture, surfaces, dimensions and history are not copied into that card or its tool result. Detailed reading remains the existing paginated `store_layout` tool. Model input cannot choose a winner, store, actor, reference, revision or dimension.

Capabilities 1–5 keep their exact input enums and artifact versions; old catalogue artifacts stay version 5. Only the new kind produces artifact version 6. Missing/unknown/combined capability headers expose no accidental fallback. Legacy tool descriptions stay unchanged; one short physical-plan clause is present only for capability 6. Existing three-preview limits, evidence, private-message validation and the SDK adapter are reused.

## Native decision and preservation

The card reads the actual local plan and complete current conflict group, verifies the synchronized full-plan fingerprint and compact metadata, then uses `StoreLayoutRepository.review/resolve`. The complete review hash includes canonical history and pending commands, with the existing scope/cancellation and atomic writer checks. The adapter retains the exact review anchor even when creation order and version/UUID order differ, and reuses the canonical active-command selection; inert superseded history neither disappears nor blocks a current choice. A new pull or changed group invalidates an old comparison.

- KEEP_LOCAL creates one new `SAVE_DRAFT` on the canonical parent/reference while retaining local content and measurement qualifications. It does not adopt a reference, confirm a measurement or declare a commercial execution.
- ADOPT_REMOTE retains the canonical plan and creates no business command.
- Reviewed refused packets are superseded, not falsely acknowledged; snapshots, immutable revisions and the explicit choice remain conserved. The existing private tool-result journal supports exact replay after SQLite reopen.
- The card reuses the plan's twelve-change expandable comparison and explains the draft/reference distinction before confirmation. A manager chooses and explicitly confirms; server-side preparation performs no mutation.

Two mounted-card counterexamples were reproduced during this work: a retained old confirmation callback could still save after a role/controller replacement or unmount. The shared card now fences callbacks against its committed controller/message scope, cancels on layout cleanup and ignores late reads. The existing focus invalidation is reused. These were actual SQLite changes in the failing assertions; initial test-fixture/import/selector mistakes are excluded from that count.

## Verification

- Thirteen real-SQLite controller cases: both decisions, preserved source/observation/catalogue rows, no false ACK, one or zero queued plan commands, private replay after file close/reopen, changed decision refusal, role/owner/store/device/review/hash/cancellation, complete-group reread, newer-pull rejection/current re-proposal and 105 preserved superseded packets.
- Four actual React card mounts with native controls represented by test hosts: both explicit decisions and the two retained-callback regressions. The shared plan comparison and canonical controller/writer run; unrelated commercial summaries are stubbed. This is not an iPhone rendering or gesture acceptance claim.
- One new SDK test negotiates versions 1–6 through the actual installed SDK and controlled HTTP transport; the existing API-client transport test now also checks header 6. No provider is called.
- Nine Fastify capability cases cover no header, 1–6, unknown 7 and combined `6,5`. Version 6 reads the authenticated target; versions 1–5 reject the new input before database access.
- Two disposable transactional-Mongo cases seed real canonical versions, obtain the conflict through actual mobile push, prepare the compact server preview, confirm in the native controller and synchronize once. Another SQLite bootstraps the same plan and is reopened offline. Refused packet replay and unrelated local source rows remain unchanged. Unrelated synthetic fixture packets are prepared outside this layout transport proof; this does not claim original-binary transfer or hardware acceptance.

Complete local `pnpm check`: **4,187 passed / 686 environment skips**, lint, repository structure and ten strict TypeScript projects pass. The two new Mongo cases and eleven existing canonical layout cases pass together (13). Formatting and exact-final-head CI remain separate delivery gates.

Initial integration fixture mistakes (an extra waste-authority field, a boolean instead of the bootstrap query string, and a missing typed observation-window option) were corrected without changing production permission/bootstrap behavior. Full local checks, formatting and exact-final-head CI results are recorded with the PR/release evidence.

## Delivery and remaining scope

Requires a grouped **API-before-native** release. Current API `4941513` and iOS build 14 (`7e46885`) do not contain capability 6; old clients remain compatible. No deployment, EAS build, provider/credential/model change or production business write is started by this increment.

M7 workstreams **1, 6 and 7 advance**; all seven global states stay unchanged (2 CODE_READY, others IN_PROGRESS). Visual-library and immutable-transcription comparisons remain separate conversational gaps. Measured pilot geometry/mobiles, illustration consent/output, expertise/real advice loop, Resend, cross-device originals and all full UX/M8/device gates remain open.

SDK pattern checked against installed `ai` 7.0.130 and the [official tool-calling documentation](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling); no agent/provider migration or global prompt expansion is introduced.
