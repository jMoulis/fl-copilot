# Catalogue — permanent push rejection state, 24 October 2026

## Reproduced defect

The actual `MobileSyncService.push` persisted a permanent `REJECTED` response as a FAILED Outbox packet, but left the product, identifier or alias row PENDING. The canonical repository therefore still reported an upload pending, although that exact command would no longer be sent. This is distinct from the CONFLICT projection corrected in PR 356.

Three SQLite assertions failed before this correction: expected ERROR, received PENDING. The transport uses strict sync response contracts and a controlled permanent rejection, not a live production or provider response. Additional preservation tests initially named the file table incorrectly (`source_files` instead of canonical `local_files`); that test setup failure is not counted as an application defect.

## Correction and policy

The existing push-result transaction projects ERROR only onto the same store/entity/local version still PENDING, with no later pending, sending or conflicted command. It reuses the same three-table allowlist as the CONFLICT branch. The packet becomes FAILED in that transaction. No business field, raw quantity, version, dirty flag, acknowledged baseline, source or original is rewritten.

A newer local edit stays PENDING. A transient error follows the existing pending/backoff path. A different unresolved conflict is not changed into an error. If the terminal packet update fails, the entity projection rolls back; the earlier sending-stage transaction remains SYNCING, as before, for interrupted-cycle recovery.

REJECTED remains permanent for that command UUID. A second manual sync does not resubmit it. A permissions rejection requires restoring the permission; a business correction uses its canonical reviewed editor and a new command. This change is neither automatic business repair nor a generic command retry.

## Evidence and limits

- Twelve new real-SQLite cases cover the three families: permanent rejection and no replay, transient error, a newer canonical edit during transport, and terminal transaction failure. Source/file/record/receipt/observation rows are checked unchanged in preservation cases.
- The four existing actual-push conflict cases still pass: sixteen targeted cases together.
- Complete local verification: **4,160 passed / 684 environment skips**, lint, repository structure and ten strict TypeScript projects pass. Formatting and final GitHub checks are recorded separately at delivery.
- No schema, API behavior, model permission, provider call, production write or dependency is added. No new EAS build is started. This code is outside iOS build 14; it does not prove physical-device acceptance or close M7/M8/V1.

Contract: `DATABASE_AND_API_CONTRACTS.md` §§74–75 distinguishes permanent REJECTED from RETRYABLE_ERROR. Source: `apps/mobile/src/sync/sync-service.ts` and `products/catalogue-push-rejection.test.ts`.
