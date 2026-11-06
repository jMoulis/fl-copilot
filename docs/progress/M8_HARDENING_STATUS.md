# M8 — hardening and pilot release

## Authority and scope — owner arbitration, 5 November 2026

The owner explicitly starts M8 after accepting the supplied build-33 chat Source/return and long-press/cancel recipe. M0–M6 and M7 workstreams 1/3/4/5/7 retain their functional iPhone pilot acceptance. Numerical counter-promotion/daily purchase tariffs and deeper measured implantation remain deferred (2/6). Missing final AI illustration files, truthful provenance and approval remain a separate explicit prerequisite, not a fabricated completion.

M8 qualifies the **iPhone pilot**. The owner retains data protection, interruption/concurrency recovery, performance/resource use, security/delivery and useful notifications, explicitly including chat completion. Android work and the dedicated accessibility qualification move to [M9 — broader platform and accessibility qualification](M9_PLATFORM_ACCESSIBILITY_STATUS.md); neither blocks this M8 exit. Preserve existing implementations, shared checks and accepted evidence. This scope change is not a claim of completion.

M8 follows T01–T06 and T08–T14 in [the implementation plan](../specs/IMPLEMENTATION_PLAN.md#128-milestone-8--hardening--pilot-release), with iOS-only platform acceptance and T07 transferred to M9. Reuse the current architecture and canonical APIs. Tests qualify existing guarantees and identify actual defects; they do not justify a new generic repair writer, runtime layer, paid model request or repeated accepted business recipe.

## Execution order and closure criteria

1. **Data protection — T03 closed through schema 62; T04/T12 active.** Current supported migrations, Outbox/original preservation, isolated local restore, retained later writes, then remote Mongo/original/read-model restore rehearsal. Close only with recovery evidence, not merely copy creation. A local copy is not device-loss/cloud backup.
2. **Interruptions and concurrency — T01/T02, open.** Offline launch, network loss during upload/import, termination with pending work, reconnection and two authorized installations changing the same supported entities. Require retained work, canonical retry without duplicate publication and resolvable conflicts.
3. **Endurance and resource use — T05/T08/T09, open.** Measure startup, repeated product navigation/editing, XLSX parsing, KPI backlog and sync on representative iPhones; qualify storage cleanup, polling/background activity and repeated AI work. Existing isolated stress tests and owner-confirmed improvement remain evidence, not a physical benchmark.
4. **Security — T06, open.** Review session lifecycle, store/owner authority, signed source URLs, MIME validation, unauthorized IDs, replay and logout behavior. Existing scoped refusal tests remain useful; they do not replace the complete current review.
5. **Useful iPhone notifications — T11, open.** Notify when an asynchronous chat answer finishes and for retained document/task reminders. Opening an alert must reach the correct owned conversation/result, including after backgrounding/restart; avoid duplicates and stale/deleted targets. Check permission refusal, token/session lifetime and delivery failure without losing the result or blocking the app. Audit the existing implementation first: these are acceptance targets, not a claim that chat-completion delivery already works.
6. **Monitoring and release — T10/T13/T14, open.** Confirm actionable crash/sync/Outbox/import/AI/job monitoring, distribution identities and compatible rollback, iOS staging/TestFlight channels, actual store configuration and documented support/recovery process. Existing staging builds and Sentry do not certify all channels.

These are six execution batches covering thirteen retained requirements, not six promised PRs or durations. For owner reporting, security/monitoring/release form one of the four reliability pillars; notifications remain an additional explicit requirement. T07 and all Android-specific acceptance belong to M9. **Current requirement closure: T03 is closed for the supported schema range through 62; T04 and T12 remain active.** This does not close the whole data-protection batch.

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

## Native restore — isolated iOS simulator rehearsal

The existing iPhone 16e simulator contains the working database and must not be reset, logged out or restored for this experiment. Its previous explicit copy (`copy-caa99d4b-7683-4fe4-8ab5-d6facbffcb25`) completed at 19:02:27 UTC on 4 November: **173,371,392 bytes**, native success state and independently matching SHA-256/manifest size. This proves copy creation, not restoration. Source binaries remain at their original private locations.

The existing official Expo Go57.0.9 binary is installed on a separate iPhone17Pro/iOS26.3.1 simulator without copying data, tokens or Keychain. Its initial SQLite database is empty at schema62; the owner logs in normally and canonical bootstrap recovers the store. The working iPhone16e is neither restored nor reset.

The actual native first-leg recipe now passes: local draft A → verified 173,346,816-byte copy → later draft B → prepare/cancel retaining B and session → canonical activation → full simulator restart → normal owner login → A visible and B absent. Independent SQL checks confirm integrity, schema62, stable device identity, 458 products, zero Outbox rows and retained PDF bytes matching size/SHA-256. The previous location still contains A+B. Returning through the canonical previous-location route, a second full restart and normal owner login also passes: B reappears in native UI and A remains. Integrity and original-byte checks pass again. The original reaches the native share sheet but is labeled archive/BIN, so PDF rendering is not accepted and its filename/MIME handoff needs correction. [Actual evidence, timings and limits](../qa/M8_LOCAL_COPY_NATIVE_REHEARSAL_2026_11_04.md).

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

The combined controlled-engine command recovery/replay case below now passes, complementing the read-only native draft rehearsal. Next gates remain native interruption/corruption/source recovery qualification and production backup/restore. The PDF correction passes its focused simulator check and awaits grouped owner-binary delivery. Cloud restore and the remaining retained M8 checks stay open; Android and the dedicated accessibility pass are tracked in M9. No full M8 or whole-V1 completion follows from this batch.

## Focused UX correction — accurate copy-operation progress

The native rehearsal reproduces a creation spinner during restoration verification. Replace only the panel's existing busy flag with an operation marker, retaining the same lock/disabled/lifetime rules and canonical services. Accessible status text describes the actual operation; no fabricated percentage, timeout, repair layer or weaker integrity check. The existing deferred interaction fails against the original component and passes with the correction. **15 targeted tests across three files pass, zero skips**, plus types/lint/format. This later mobile-only label patch has its own delivery boundary and does not justify a paid binary by itself. [Proof](../qa/M8_LOCAL_COPY_NATIVE_REHEARSAL_2026_11_04.md).

## Original-file opening — focused iOS correction, 5 November

The existing canonical original reader now provides a verified typed copy when an email-retained original has a `.bin` path. It reuses the private actor/store/source/hash directory, verifies source and copied bytes/header, awaits copy/relocation and preserves immutable originals, metadata and commands. Sender filenames are not used as paths. A corruption/failure never overwrites the existing typed file or deletes the original.

**112 targeted tests across four suites pass, zero skips**, with the new PDF assertion reproduced failing before correction; workspace typecheck, targeted lint and formatting pass. On the same isolated iPhone17Pro simulator, the retained PDF is recognized as Document PDF, and its actual pages render in Aperçu. Independent readback verifies original/copy size and SHA-256 with zero Outbox rows. [Evidence and delivery limits](../qa/M8_TYPED_ORIGINAL_OPENING_2026_11_05.md). This closes the reproduced BIN-to-viewer defect on the simulator, not all T04 or owner-phone delivery. No API deployment, new EAS binary, source reimport or paid model request.

## In-flight business-command restoration — 5 November

Two combined tests use the existing SQLite backup/restore paths, native mobile writers/sync and the real transactional Mongo command journal. Cover loss before server commit and loss after commit without acknowledgement, snapshot while SYNCING, exact journal preservation after reopen, ordinary recovery to APPLIED/ALREADY_APPLIED, no second mutation/version bump and return to the prior location without duplicate changes. **21 native-recovery suite cases pass, zero skips**, including both Mongo cases; combined migration/recovery/sync/Outbox/provider/session validation passes **231 tests across eight files, zero skips**. [Detailed evidence and limits](../qa/M8_RESTORED_COMMAND_REPLAY_2026_11_05.md).

T03 is now **CLOSED for supported schemas through 62** against its declared migration/Outbox acceptance criteria; existing migration and SIGKILL evidence is retained. T04 stays active: real-engine tests with controlled Expo ports are not a physical iPhone interruption/corruption or cloud restore claim. This increment adds only tests/documentation, without runtime changes, paid AI requests, EAS build or API deployment.

## 5 November — actual process loss during local import

Six child-process SIGKILL cases exercise current sales/waste publication after an observation insert, immediately before COMMIT and immediately after COMMIT. Reopen proves exact prior state or complete publication; original XLSX bytes, prior work, device/command identities and jobs survive. Canonical retry publishes once or returns the existing exact-duplicate refusal. No graceful rollback runs in the killed child.

**137 tests across seven files pass, zero skips**, including existing batch/continuation/upload/sync/original-transfer cases; ten-project typecheck and targeted lint pass. This is host SQLite/process evidence. **T01 remains open for native iPhone network/termination qualification**. No runtime layer, dependency, EAS build, API deployment or paid provider request is added. [Evidence and boundaries](../qa/M8_IMPORT_PROCESS_INTERRUPTION_2026_11_05.md).

## 5 November — automatic retry while backgrounded

Two mounted-provider assertions reproduce an unnecessary retry after a network failure while AppState is backgrounded. The existing 60-second callback now rechecks for active state. Existing foreground resume remains immediate, active-state timed retry still works and pending commands remain exact. **53 tests across four files pass, zero skips**, with six mounted lifecycle cases. No new runtime layer, dependency or listener.

Device Hub stopped exposing its window during the attempted isolated native recipe; reacquiring it timed out. No network outage or native acceptance is claimed. **T01/T09 remain open** for native qualification and wider consumption review; this mobile correction awaits grouped delivery. [Evidence and boundaries](../qa/M8_FOREGROUND_SYNC_RETRY_2026_11_05.md).

## 5 November — current conflict qualification

Eight real-Mongo integration suites and five SQLite/review/mounted-screen suites pass **524 tests across 13 files, zero skips**. The existing two-choice recommendation conflict scenario now uses distinct A/B/C device IDs and persistent SQLite files; Outbox and server journal prove both writer identities, explicit resolution converges and C reopens offline. No runtime or new conflict writer is added.

**T02 remains open** for physical concurrent-device qualification and reconciliation of the old generic ExecutionInstruction label with the retained commercial task/declaration workflow. The generic bootstrap slot is still empty; no generic model completion is claimed. Existing approved M7 functional acceptance is unchanged. [Exact mapping, results and limits](../qa/M8_DISTINCT_DEVICE_CONFLICTS_2026_11_05.md).

Device Hub subsequently became available after the owner reopened it. A read-only iPhone17Pro/Expo Go smoke test invoked its memory-warning command, backgrounded/resumed the app and retained the product detail, 463-product catalogue and existing unsent draft B. This is neither a measured memory-exhaustion/termination test nor native network-loss qualification. Evidence is retained outside Git in the task artifacts; T01/T08/T09 remain open for their wider native gates.

## 5 November — build34 accepted cases and session revocation

The owner confirms both build34 tests: retained commercial PDF opens correctly, and airplane-mode/WiFi-off cold launch retains cached product/analysis reads before successful reconnection/sync. These two cases are **accepted and closed**; the PDF correction is delivered. Do not repeat them. T01 still retains mid-transfer network/termination cases; M8 as a whole is not closed.

Four actual-Mongo auth races reproduce before correction. Conditional refresh now cannot override logout/newer credentials; verified login transactionally replaces the device session ID so old access/logout tokens cannot act on the new session. Seven new cases and existing auth/source/native-session suites pass **124 tests across nine files, zero skips**. No mobile contract/model/migration changes or forced global logout; compatible with build34. **T06 remains active**, and API delivery is recorded separately. [Proof and limits](../qa/M8_SESSION_REVOCATION_RACES_2026_11_05.md).

## 5 November — selected-original memory and cloud backup preflight

The explicit local PDF/XLSX reselection adapter now reuses the existing incremental file verifier instead of reading up to 100 MiB at once. Exact reviewed SHA-256/size, immutable originals, authority and canonical repository transaction remain required. **115 targeted tests across three files pass, zero skips**, plus workspace typecheck and targeted lint. Physical iPhone memory measurement and grouped binary delivery remain open. [Evidence](../qa/M8_BOUNDED_ORIGINAL_RESTORATION_2026_11_05.md).

Atlas console access was restored. Cluster0 in `fl-copilot-dev` offers enabling daily backups; no available snapshot was established. Free-tier daily backups are now optional in gradual preview, so tier alone is not evidence of backup absence. The owner explicitly deferred the paid backup subscription. **T12 remains open and owner-deferred**, including production-target identification, isolated Mongo restore, private source access and read-model rebuild. No paid subscription, cluster upgrade, production dump/restore or replacement backup architecture was introduced. This reserve must remain visible in pilot readiness reporting.

## 5 November — chat-completion notification increment

The new iPhone increment reuses Expo notifications, existing authenticated device sessions, canonical chat persistence/sync and notification settings. Explicit per-phone opt-in registers the current session; generic content-free completion alerts are sent only after a new durable answer. Registered requests can finish under the bounded Vercel lifecycle after leaving the stream. Owned result opening, stale/deleted targets, duplicate taps, permission refusal, failed disable retry and token/account lifetime are qualified separately. No new collection, business Outbox, job queue or AI call is introduced.

Existing Apple Push credentials were associated with the staging application, and Expo introspection shows the APNs entitlement. **T11 remains open:** exact-head checks, compatible API release, signed native build, real iPhone delivery/opening and the retained document notification scope remain separate gates. Build34's accepted PDF/offline recipes stay closed. [Implementation evidence, acceptance and limits](../qa/M8_CHAT_COMPLETION_NOTIFICATIONS_2026_11_05.md).

The focused implementation passes **110 tests across eleven files, zero skips**, ten-project strict typecheck, targeted lint, API build/import and mobile export. Apple reports account-locked error `-20209` during signing-profile preparation; the owner is handling recovery. No paid native build has started and no APNs delivery is claimed. Continue independent review/CI; wait for explicit recovery confirmation before retrying Apple login.

Two mounted-provider tests additionally verify no registration on background mount/token events, one reconciliation on foreground return, stable registration across 100 ordinary rerenders and complete listener cleanup. The background token-event case failed before its foreground guard was added. Aggregate validation is 108 tests in the prior ten-file run plus these two final component tests.

### T09/T11 — build35 background-completion rejection, 6 November

Owner reports chat completion stalls after leaving the app. **Build35 background completion is not accepted.** Investigation reproduces native token-event registration feedback and identifies plain-question dispatch/final completion waiting on unrelated full synchronization jobs. The latest inspected question was synchronized but generation had not started. Correction reuses cached native tokens and canonical Outbox push/pull for plain chat while retaining attachment preparation. 114 targeted tests, zero skips, ten-project types and targeted lint pass. API unchanged; new native delivery and physical background acceptance remain open. [Diagnosis, regression and limits](../qa/M8_BACKGROUND_CHAT_DISPATCH_2026_11_06.md).

### T01/T11 — immediate background dispatch after build36 feedback, 6 November

Owner confirms notification/completion after streaming starts but rejects leaving during initial preparation. PR454 removed unrelated file work but still awaited push/pull and a second client request; production timestamps confirm the gap. The correction hands the existing private Outbox commands and turn IDs to the server in one request, reusing canonical authenticated push, journal, lease, persistence and lifetime/notification paths. No new models/jobs. 188 targeted tests across 14 suites pass with transactional localhost Mongo, zero skips; ten-project types, lint, API build and iOS export pass. **API delivery, native delivery and immediate-background iPhone acceptance remain open.** [Design, evidence and boundary](../qa/M8_CHAT_SINGLE_REQUEST_HANDOFF_2026_11_06.md).

### T11 — owner-requested reply preview, 6 November

The owner requests a real answer excerpt in completion alerts, superseding the original generic-body choice. The existing authorized persisted ASSISTANT message now supplies a plain preview of at most 180 Unicode code points, with Markdown/link destinations removed and ellipsis for truncation. A generic body remains only when no visible text survives. Typed navigation IDs, scope/deletion checks, notification timing and deduplication remain unchanged; no model call, database schema, preference or native contract is added. 32 targeted tests across four suites pass on transactional localhost Mongo, zero skips, including preview formatting/length, persisted-text readback, authorization, one-request handoff and notification lifetime. Ten-project types, targeted lint and API bundle/import pass. API-only delivery is sufficient for build37; actual preview receipt remains to verify after release.
