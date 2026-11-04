# M8 — hardening and pilot release

## Authority and scope — 4 November 2026

The owner explicitly starts M8 after accepting the supplied build-33 chat Source/return and long-press/cancel recipe. M0–M6 and M7 workstreams 1/3/4/5/7 retain their functional iPhone pilot acceptance. Numerical counter-promotion/daily purchase tariffs and deeper measured implantation remain deferred (2/6). Missing final AI illustration files, truthful provenance and approval remain a separate explicit prerequisite, not a fabricated completion.

M8 follows the existing T01–T14 requirements in [the implementation plan](../specs/IMPLEMENTATION_PLAN.md#128-milestone-8--hardening--pilot-release). Reuse the current architecture and canonical APIs. Tests qualify existing guarantees and identify actual defects; they do not justify a new generic repair writer, runtime layer, paid model request or repeated accepted business recipe.

## Execution order and closure criteria

1. **Data protection — T03/T04/T12, active.** Current supported migrations, Outbox/original preservation, isolated local restore, retained later writes, then remote Mongo/original/read-model restore rehearsal. Close only with recovery evidence, not merely copy creation. A local copy is not device-loss/cloud backup.
2. **Interruptions and concurrency — T01/T02, open.** Offline launch, network loss during upload/import, termination with pending work, reconnection and two authorized installations changing the same supported entities. Require retained work, canonical retry without duplicate publication and resolvable conflicts.
3. **Endurance and resource use — T05/T08/T09, open.** Measure startup, repeated product navigation/editing, XLSX parsing, KPI backlog and sync on representative iOS/Android devices; qualify storage cleanup, polling/background activity and repeated AI work. Existing isolated stress tests and owner-confirmed improvement remain evidence, not a physical benchmark.
4. **Security — T06, open.** Review session lifecycle, store/owner authority, signed source URLs, MIME validation, unauthorized IDs, replay and logout behavior. Existing scoped refusal tests remain useful; they do not replace the complete current review.
5. **Accessibility and notifications — T07/T11, open.** Full VoiceOver/TalkBack, enlarged text, keyboard/targets/statuses; notification permissions, token/deep-link/context lifetime for retained channels. Build 33 closes only its supplied focused recipe.
6. **Monitoring and release — T10/T13/T14, open.** Confirm actionable crash/sync/Outbox/import/AI/job monitoring, distribution identities and compatible rollback, TestFlight/Play internal channels, actual store configuration and documented support/recovery process. Existing staging builds and Sentry do not certify all channels.

These are six execution batches for fourteen requirements, not six promised PRs or durations. No complete M8 requirement is closed by the first technical batch below.

## First batch — current-schema preservation

Before changes, **188 tests in six suites pass, zero skips**. The existing matrix already upgrades/reopens every declared schema through v62 and simulates rollback at each pre-COMMIT boundary. Its real process-kill cases previously ended at v59→60.

Extend that existing suite with real SIGKILL/WAL recovery at **v60→61 and v61→62**. The v61 migration rebuilds the commercial-choice table: fixtures now retain actual local/remote payload bytes, version/dirty/sync metadata and references from v18 onward, plus nullable original-backed references from v61. Existing v62 private document-archive rows are also preserved, including their pending-command identity. These are explicitly opaque storage fixtures, not a claim that the abbreviated payloads constitute publishable business commands.

After each kill, the reopened database must still have its prior schema and exact selected durable rows, then upgrade normally with its stable device/Outbox IDs, sequence high-water marks and original file bytes. Integrity and foreign-key checks pass. No exception timing, assertion or migration implementation is weakened.

**Result: 190 tests across six suites pass, zero skips:**

- `migration-preservation.test.ts`: 132, including 62 upgrade/reopen cases, 61 pre-COMMIT rollback/retry cases and nine actual child-process SIGKILL cases.
- `database-recovery-native.test.ts`: 19, real SQLite/files with controlled Expo/SecureStore ports.
- `database-recovery.test.ts`: 24.
- `local-copies-panel.test.ts`: five mounted panel interactions.
- `database-provider.test.ts`: two provider lifecycle cases.
- `database-recovery-session.test.ts`: eight ownership/session cases.

The production runtime, schema, APIs, AI instructions and business data are unchanged. This test/documentation batch needs no EAS build or API deployment. CI/merge state is recorded separately; these local counts do not imply physical iOS/Android termination or corruption repair.

## Native restore preparation — not yet executed

The existing iPhone 16e simulator contains the working database and must not be reset, logged out or restored for this experiment. Its previous explicit copy (`copy-caa99d4b-7683-4fe4-8ab5-d6facbffcb25`) completed at 19:02:27 UTC on 4 November: **173,371,392 bytes**, native success state and independently matching SHA-256/manifest size. This proves copy creation, not restoration. Source binaries remain at their original private locations.

A read-only inventory finds separate available iOS simulators; no second authenticated test installation or successful restore is established. Do not clone session tokens, Keychain or device identity from the working installation to bypass normal authentication.

Use an isolated installation with authorized access and the current source/build:

1. Authenticate normally and complete the canonical bootstrap. Record its distinct device identity and zero unintended pending production writes. Use a local-only chat draft for the initial native preservation recipe; do not submit fabricated product changes to the real store.
2. Save draft A without sending it. Create and verify a local copy. Save a different later draft B in the active location.
3. Select the owned copy, prepare it and inspect the separate confirmation. Cancel once: session, active route and both current drafts must remain unchanged.
4. Prepare again and explicitly confirm. Close/reopen the app as instructed, authenticate as the original owner and verify draft A, device identity, integrity and retained source access. Draft B belongs to the preserved previous location, not the older selected snapshot.
5. Use the retained previous-location route to recover draft B, again through the existing verification/restart/owner gate. Never silently merge SQLite tables or copy a live DB without its WAL.
6. A separate controlled-store recipe must cover unsent business-command replay and no duplicate publication. Read-only real-store restoration does not certify that mutation case.

Do not uninstall, erase an installation, activate an unowned copy, replay unknown commands or test damage against the only working base. Production backup restoration must target a separately identified restore environment; access, backup availability and object retention require actual verification before execution.

## Evidence and remaining boundary

Owner-private logs/JSON remain under `artifacts/2026-11-04-m8-current-schema-recovery/` outside Git. The prior local-copy and build-33 acceptance ledgers remain outside Git as well. No secrets, source documents or production database contents belong in PR attachments.

Next gate: a separate authenticated native test installation and actual restore/restart/return-to-previous-location evidence. Cloud restore, Android and the remaining T01–T14 checks stay open. No full M8 or whole-V1 completion follows from this batch.
