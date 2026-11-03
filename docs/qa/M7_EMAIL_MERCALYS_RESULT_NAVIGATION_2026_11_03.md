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
