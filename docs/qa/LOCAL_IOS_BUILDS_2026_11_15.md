# Local iPhone release qualification — 15 November 2026

## Owner decision and current status

The owner requests local compilation to avoid further paid EAS cloud builds.
The default is now the owner's Mac; the previous standing paid-build authority
is withdrawn. A new paid cloud compilation requires a new explicit owner
agreement. Budget renewal in early December does not automatically restore
that authority. The current rule is recorded first in
[the release process](../RELEASE_PROCESS.md).

**The first local delivery is qualified and owner accepted.** Actual build
`0.1.0 (68)` used clean source `7339a670b73ada6eef22dd82d78c5a23abe6bcf6`.
The owner confirmed the focused iPhone recipe after private TestFlight delivery.
This documentation update does not require another native build.

## Reuse and boundaries

Keep Expo SDK 57, React Native, config plugins, canonical synchronization and
the existing production profile. EAS cloud compilation and the Expo framework
are separate. Local EAS compilation produces the native archive on the Mac;
it still uses the existing account, credentials, environment and remote version
services. This is not an offline-build guarantee or a new delivery architecture.

Retain the existing Apple team, `com.flcopilot.mobile`, app version `0.1.0`,
production APNs entitlement and private owner-only TestFlight target. Do not
create or replace certificates, provisioning profiles or push keys merely to
make local compilation proceed. Signing access and archive verification remain
required even when the compiler runs locally.

## Audited preparation

- The selected developer directory is `/Applications/Xcode.app/Contents/Developer`.
  Xcode 27.2 and the iOS 27.2 device/simulator SDKs are available.
- CocoaPods 1.17.0 and Node 24.14.0 are available. Fastlane 2.241.2 has now
  been prepared in an isolated local tool directory. The Fastlane/CocoaPods
  wrappers keep gem environments separate to avoid dependency conflicts. This
  preparation is not yet proof of a completed release archive.
- There is no generated `apps/mobile/ios/` in the inspected source. The existing
  managed Expo preparation must generate native files in the isolated build
  workspace; do not check generated native files into the repository as part
  of this change.
- EAS CLI is pinned to 24.8.0. Its local branch passes a local source archive to
  `eas-cli-local-build-plugin@24.8.0` instead of calling the cloud iOS build
  creation mutation. Use the matching plugin and prepared local dependencies.
- The production profile already specifies the production environment,
  `autoIncrement: true` and remote app-version numbering. The local path can
  reserve the next native number through the existing version service without
  starting a cloud compiler. Read the actual allocated number; do not assume or
  reuse one. A failed attempt can still consume a number.

## Qualification history and actual outcome

The first preparation attempt stopped on a CocoaPods tooling conflict, addressed
by the isolated wrappers above. The second stopped because the signing chain
lacked the official Apple G3 intermediate. That official intermediate was
retrieved, its chain checked, and added to the user's keychain without a custom
trust override. The existing Apple Distribution identity then passed its signing
identity check; no new distribution certificate or replacement profile is claimed.

The third local attempt stopped on the old Sentry upload credential. After the
owner explicitly authorized reuse of the existing authenticated CLI credential
in process memory, build 68 completed without disabling the diagnostic uploads.
No token was written to a file by the local build runner. Build phases completing
do not independently prove server indexing of every source map or native symbol.

The actual STORE IPA passed signature, profile, team/bundle, production APNs,
production API and content checks. Its SHA-256 is
`2fca537091081a068625bb71be8f46f27227e15947e126827bb7ce6fee33968c`.
Source provenance joins the clean checkout and successful local-run record; it
is not claimed to be cryptographically recovered from the binary.

Local Fastlane uploaded that verified IPA directly to App Store Connect using
the existing submission key in temporary protected files, removed afterwards.
No EAS Submit job, new signing identity, tester invitation or public release was
created. Apple reports build 68 as `VALID` / `IN_BETA_TESTING`, and membership in
the existing owner-only internal group was read back. The before/after cloud
lists contain the same 15 IDs; build 64 remains the latest cloud compilation.
The owner subsequently confirmed build 68 acceptance. Private evidence is in
workspace `maintenance/local-ios-build/first-local-release/delivery.json`.

## Local compilation procedure

1. Check the exact clean source commit and its passing checks, selected Xcode,
   prepared local tool versions and intended production profile. Run EAS from
   `apps/mobile`, where this project is configured; do not initialize or link
   another project as a side effect.
2. Use the existing production environment. `EXPO_PUBLIC_API_URL` is required;
   preserve the production Sentry DSN and source-map/debug-file upload settings.
   CLI 24.8.0 can resolve Plain text/Sensitive EAS values. Secret values are not
   exported by that path and must be supplied through an approved local secret
   source if needed. Never print values, commit them or disable Sentry uploads
   to conceal an unresolved preparation failure.
3. Use a private output directory and local temporary workspace. Keep normal
   credential cleanup enabled, and avoid debug logging that could expose process
   environment values. Reuse existing signing credentials with
   `--non-interactive --freeze-credentials`; stop on a genuine signing blocker
   instead of generating replacements.
4. Invoke the pinned CLI's `build` command with `--local --platform ios`,
   `--profile production`, the credential flags above and
   `--output /absolute/private/path/FL-Copilot.ipa`. This is the local branch.
   Do not add automatic submission or a cloud fallback. Keep the compile log
   private and record the allocated native build number.
5. Verify the actual IPA before submission: bundle/version/build, strict code
   signature, Apple team/profile, STORE distribution, APNs `production`, expected
   API and release markers/assets. Record the archive bytes and SHA-256. A build
   command returning zero is not a substitute for inspecting its output.
6. Submit only the verified local IPA using the existing private TestFlight
   delivery path. Keep automatic tester setup disabled. Record submission,
   Apple processing, owner-only availability and physical acceptance separately.
   A local archive does not have a cloud EAS build ID; submit by the actual file
   path rather than fabricating an ID or borrowing a previous build's identity.

## Evidence and acceptance gates

- [x] Local dependencies and production environment qualified.
- [x] Local compilation completes and produces the expected IPA.
- [x] Actual archive signature/APNs/content and source provenance verified.
- [x] Cloud-build IDs compared before/after; no new compilation job attributed
      to this local attempt. Preserve the command/log evidence of the local path.
- [x] Verified local IPA submitted and accepted by Apple.
- [x] Build available in the existing private owner-only TestFlight group.
- [x] Owner accepts the focused iPhone recipe on that exact local binary.

Retain private attempt evidence outside Git in workspace
`maintenance/local-ios-build/`. Record source SHA, actual tool versions, local
command, native number, archive checksum and each observed delivery state. Never
retain raw credentials or a fabricated `FINISHED` cloud-build JSON as provenance.
A comparison of build IDs supports absence of a new cloud job; account reads,
version allocation or a submission record are separate operations.

This record preserves the existing successful TestFlight delivery as a rollback
reference. It does not reopen accepted M0–M8 tests, authorize a paid fallback or
require a build/deployment for documentation-only changes.
