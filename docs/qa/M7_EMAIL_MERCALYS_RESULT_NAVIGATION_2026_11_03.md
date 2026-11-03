# M7 — open the actual Mercalys email result

## Concrete UX gap

The owner accepted email reception/confirmation and found the published `16102026.xlsx` manually in Imports Mercalys. The email card only said “Transmis au traitement métier”; it did not open that result. Reuse the existing result screen instead of requiring the manager to find the file again.

## Change

The confirmed email file exposes **Ouvrir l’import Mercalys** only when the canonical owned batch actually exists locally. `readEmailMercalysResult` reuses the acknowledged admission/receipt authority and the existing deterministic processing identity plus MercalysBatchRepository.header. It performs no file read/download, capture, retry, publication, Outbox write or model call. An inferred filename or a completed handoff alone never creates a result. A missing local batch returns no link; role/session/source changes remain rejected.

The existing Actions stack opens `actions/email-import` with a validated UUID. The route retains manager/owner/store context and reuses MercalysImportScreen and MercalysBatchPanel. Initial opening reads the exact owned header, first bounded file page and retained publication results, including a batch outside the recent history page. It does not prepare pending files or publish on mount. That direct-result path also skips the manual screen’s mount-time analytics dequeue; explicit subsequent publication keeps its existing canonical behavior.

The normal page-sheet, file review, ZIP controls, reconciliation and archive controls remain. Closing the directly linked batch by its return button or the sheet’s native close event returns to the retained email screen, rather than an intermediate import history. The email list stays on the Actions stack. Ordinary manually opened batches retain their existing return-to-imports behavior.

Read callbacks are invalidated by context/unmount/cancellation, and the destination is checked again at press time. Failed refresh retains existing content; an explicit state retry performs one read rather than duplicating it. No polling, new database model/schema, API endpoint, sync command, importer, prompt or provider is added.

## Verification

**52 tests pass in four focused existing/new suites, zero skips.** Real SQLite validates no result before actual handoff, no side effects/file reads during discovery, stable result identity and access loss during lookup. Mounted React components exercise the button, missing/changed result, delayed context switch, retained content after refresh failure, one read per explicit refresh, an exact batch absent from the recent page, both close callbacks and unavailable headers. The actual import screen’s linked mode does not read workbook bytes, publish or start background recomputation. Native ports/routing boundaries in mounted tests are controlled; actual iPhone back/swipe/scroll acceptance is separate.

Mobile strict types, targeted ESLint/format and structure checks are recorded with final CI. No API release is required. The next compatible native binary is needed; this UI change is not in build 27. No installed device version or physical gesture result is inferred from an exported app or a scripted component test.

## Focused iPhone recipe after delivery

1. In Actions → Documents reçus par email, expand the existing confirmed `16102026.xlsx`; do not send/import it again.
2. Tap Ouvrir l’import Mercalys. Expect its existing lot and 159 published lines, not a new import/publication.
3. Close the sheet by its return button, then by swiping on another opening. Expect the same email list and position. Ordinary Mercalys history/file review remains reachable through its normal entry.

M7 workstreams 3/7 advance. Workstreams 1 and 4 stay closed. The accepted email/Mercalys publication, partial banana realization and historical grape review are not reopened; the banana’s actual dates and future numbers remain unknown.

## Delivery and owner acceptance

PR 426 is merged at `2af200beb57568189ba38bbfe6d32f0805f43ec9`; exact-head push/PR and merged-master CI pass, and the branch is deleted. iOS staging/internal build 28 is FINISHED ([artifact](https://expo.dev/accounts/julesmoulis/projects/fruits-vegetables-copilot/builds/8a3b3a3d-907a-474e-a3fd-36b5bb0c1d65)). The downloaded IPA identifies `com.flcopilot.mobile`, version `0.1.0`, build `28`; its SHA-256 is `b11a0767b8717cbc954e7b4948c2aad1a32365a6306f531dcc2ea81d53623d72`. API source `7734b0f` stays deployed and healthy, with the database connected.

The owner replies to the supplied navigation recipe: “tres ben. c’est testé et valiidé”. **The focused open-result/return case is closed.** The device version was not independently read; no further import or gesture test is requested without a regression. This does not close every document format or all M7/M8.
