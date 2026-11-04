# M8-T04 — isolated native local-copy rehearsal, 4 November 2026

## Installation and scope

Use a separate existing **iPhone 17 Pro / iOS 26.3.1 simulator**, not the working iPhone 16e or the owner's phone. Install only the already available official Expo Go **57.0.9** binary; no application data, tokens, Keychain or device identity are cloned. The owner's normal login is confirmed. Before login, read-only SQLite inspection finds schema 62 and zero products, messages and Outbox rows.

Current-source Metro on port 8082 uses the existing production API. The runtime being exercised is the build-33-compatible source `e9b8ba4`; PR 442 adds only tests/documentation. No provider request is submitted by the recipe. Ordinary canonical bootstrap and previously requested email/source work may resume; they are not independently metered as zero consumption.

## Actual first restoration

1. Canonical bootstrap recovers 458 products and 42 stored conversations. The existing `semaine45.pdf` local upload/registration job finishes in one attempt, with a confirmed retained 2,025,225-byte original. No test product, offer, message, decision or execution is submitted.
2. In an existing discussion, type the explicitly unsent local draft **A**. Create the native private copy. Independent SHA-256/manifest/size verification matches **173,346,816 bytes**. The copy contains A and no queued commands.
3. Type the explicitly unsent draft **B** in another existing discussion. The working location contains A+B with the same device UUID; the earlier copy contains A only. Both remain at schema 62.
4. Prepare the owned copy, inspect the separate confirmation and cancel. The session remains open and B remains visible. No location is switched.
5. Prepare again, confirm through the canonical UI and wait for the root to close operational providers before activation. The app displays the required close/reopen instruction. Restart the whole test simulator through Device Hub, not merely Fast Refresh. The owner reopens the project and logs in normally.
6. Actual native screenshots show **A present** and the B conversation's composer empty. Read-only checks of the selected generation confirm schema 62, SQLite `quick_check=ok`, no foreign-key violations, 458 products, the original device UUID and zero Outbox rows. The previous original location still contains both A+B and passes the same integrity checks. The PDF's original bytes, size and SHA-256 match in both locations. Binary presence/hash is not by itself proof that its native viewer has opened.

Returning through **Base précédente conservée** uses its actual owned route, not a raw SQLite swap, injected route or token copy. Its preparation and separate confirmation complete with zero unacknowledged commands. After canonical activation, a second full simulator restart and normal owner login, native UI shows B recovered and A still present. Read-only checks of this selected generation and the retained A-only generation again pass integrity, schema, device identity, 458 products, zero Outbox rows and canonical SHA-256-prefixed PDF checksum checks. This closes the scoped draft-copy round trip, not queued business-command replay.

The restored original reaches the application original-file sheet and the native iOS share sheet without transmission. However, the share sheet labels the original as an archive/BIN rather than rendering a PDF. File presence, size and canonical SHA-256 match, but PDF preview is **not** accepted; preserve this MIME/filename handoff issue for correction rather than reporting a successful viewer opening.

## Measured development-runtime wait

Completed preparation markers record **357.82 s** for the canceled first candidate and **345.91 s** for the second candidate; return-to-previous preparation takes **331.16 s**. Measurements use the candidate's native start timestamp and final prepared-marker modification time on this 173 MB Expo Go development installation. They include the preparation workflow, not an isolated SHA benchmark. They do not establish physical release-binary timing or a specific bottleneck.

Keep this as a performance item for T08. No checksum, source-stability check, migration/foreign-key check or owner gate is removed to make the test finish faster. Canceled candidates and original files remain preserved; cleanup requires its own T05 qualification.

## Reproduced progress-label defect and correction

During **Vérifier cette copie**, the existing panel spins **Créer une copie maintenant** because a shared busy flag drives that unrelated button. A native screenshot and the existing deferred-preparation interaction reproduce the mismatch. The selected assertion fails against the original component because its create-button loading flag is true during preparation.

Replace the local busy state with a four-value UI operation marker and derive the same disabled guard from it. The existing lock, account/store lifetime checks, error handling and separate confirmation remain. An accessible polite text status describes reading, creating, verifying or resuming; the creation spinner runs only for actual creation. Do not invent percentages or internal phase completion.

**15 targeted tests across three files pass, zero skips**: existing copy-panel, database-provider and recovery-session suites. The deferred preparation case verifies correct progress, disabled competing controls and no premature logout/activation, then retains its existing explicit-confirmation assertions. Native recovery itself is exercised on the unchanged runtime above; this later label patch is distinct from a delivered/phone-accepted binary.

## Remaining gates and evidence

Owner-private native screenshots, SQL readback, timing JSON and test logs remain in the workspace `artifacts/2026-11-04-m8-current-schema-recovery/`; do not upload production content or credentials as public PR evidence. Device Hub loses embedded iOS accessibility nodes after the full reboot. Screenshot-based clicks work; the owner assists navigation and confirms ordinary click-and-drag scrolling. No shell-based UI automation or authority bypass is used.

Unsent business-command replay requires a separate controlled-store scenario: this native draft recipe deliberately has zero queued business commands. Physical iPhone/release-binary timing, Android, arbitrary corruption repair and production Mongo/source/read-model restoration remain separate. The Atlas plugin is connected but exposes no snapshot tools; the installed Atlas CLI has no authenticated session, so no cloud snapshot availability or backup/restore is claimed.

No API deployment, paid AI test, new EAS binary, schema or recovery writer is required by the progress-label patch. Merge/CI/delivery identities are recorded separately. This rehearsal does not close all T04, the data-protection batch or M8/V1.
