# M7 — visual metadata recovery in the conversation, 24 October 2026

## Canonical manual path reused

The existing manual `VisualRecoveryRepository` can review a rejected local creation with no cached remote row. The conversational conflict comparison required a known remote entity. The new opt-in **visual-action capability 3** adds `REVIEW_RECOVERY` to the existing `product_visual_preview`, with one exact product ID and no model-chosen local record, action, rights or write authority. Capabilities 1 and 2 retain their strict input schemas and behavior.

The server prepares **REVIEW_LOCAL**, not a claim that a failure exists or a retry is permitted. Its visual graph stays unknown; an absent catalogue entry is not asserted as a remote deletion. The device reads only the exact product link, identity and at most two associated assets, including tombstones. It then calls the manual review service for actual local ERROR records. A local missing parent may still permit canonical cleanup, but not silent recreation. A changed known product proof blocks the request.

The card uses the same extracted manual choice presentation and eligibility/consent checks. It permits **one explicitly selected record and action per proposal**: retry, remove the product association, retire a local choice or adopt a known remote version where the canonical service allows it. Additional failures need their own fresh review. Upload rights and reactivation of a withdrawn element remain separate decisions; the model never supplies them.

## Atomicity and scope

The existing controller verifies the persisted private proposal and assistant/user context, source product where available, full current related graph and manual review hashes. Confirmation rechecks actor/store/role/lifetime and the selected related record through the outer transaction. The unchanged canonical recovery writer owns metadata, new command identity, strict-create/known remote preconditions, superseded terminal commands, history, file-job cancellation and original preservation. The existing private result journal commits in that same transaction and replays once after restart. A changed decision is refused. No new database entity, migration, universal conflict writer or direct database/storage mutation tool is added.

A successful metadata decision remains successful if the subsequent existing file retry, synchronization or navigation notification fails. The UI identifies file transfer as a separate pending state. It does not fabricate an acknowledgement, available binary, manifest or completed upload.

## Evidence

- **26 real SQLite controller cases**: all three metadata kinds, unknown/known remote baselines, four canonical actions where eligible, current product/graph/private-question changes, wrong target, missing rights, role/abort, queued cancellation, cancellation during history write, result failure rollback, missing local parent cleanup and file-backed restart replay.
- **Five mounted native-card cases**: separate comparison/rights, actual canonical write, stale confirmations after role loss/ABA return, obsolete checkbox after reread, preserved selection/consents without another SQLite read for an identical message reread, and a committed result preserved when file retry or notification fails. Native hosts are controlled; this is not physical gestures, VoiceOver/TalkBack or camera acceptance.
- Strict domain inputs refuse native decisions/authority/source IDs from model arguments. HTTP tests negotiate 1/2/3 and reject missing, combined and unknown versions. Installed SDK/provider tests expose the local review only for capability 3 without model mutation; client tests retain the request body and encode the explicit header. No live model request is made.
- The Mongo replica-set case starts with **no remote visual**, gets the canonical server review intent, confirms one native strict-create retry, observes APPLIED then ALREADY_APPLIED, and restores the same metadata into another file-backed SQLite through bootstrap/pull and offline reopen. Other pending related records are not silently retried. The original server fixture used a different clock from the local product fixture and correctly produced STALE; using the existing deterministic server clock made the valid scenario consistent without weakening the product hash.
- Full local `pnpm check`: **4,403 passed / 718 skipped according to environment**, ten strict projects, lint and structure. **418 targeted tests in 13 files pass with the actual local Mongo replica set**. Exact-head push/PR CI and release identities are recorded privately in the task workspace. Existing manual/review/assignment tests remain exercised.

All generation/provenance/approval in test fixtures is controlled test data. No production image is imported, no human approval or real Blob/phone sync is claimed, and no provider/key/budget is changed. The separate real-image pilot remains blocked by its actual files/provenance/session/approval and device gates.

## Delivery and remaining V1 gates

This requires **grouped API-before-native delivery**. Build 15 remains unchanged; no isolated paid EAS build is started. Older clients keep capabilities 1/2. Real native recovery and transfer, actual expert dialogue/decision loop, receiving-email permissions and complete channel flow, second-device originals, measured plan/mobiles/approved illustrations and full UX/M8 acceptance remain open.

M7 **1/7** advance; global states stay **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This closes this manual/conversational recovery path in tested code, not every remaining CRUD exception or the complete V1.
