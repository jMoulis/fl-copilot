# Local iPhone release qualification — 15 November 2026

## Owner decision and current status

The owner requests local compilation to avoid further paid EAS cloud builds.
The default is now the owner's Mac; the previous standing paid-build authority
is withdrawn. A new paid cloud compilation requires a new explicit owner
agreement. Budget renewal in early December does not automatically restore
that authority. The current rule is recorded first in
[the release process](../RELEASE_PROCESS.md).

**Qualification is in progress.** A proposed local command, installed toolchain
or source review does not prove a signed archive, a successful upload or device
acceptance. No successful local release is claimed by this document. The first
attempt targets existing clean application source
`a5860476c96aa2404bc6c852a0a52a416f2d53cc`; this documentation does not require a
new native build. Actual outcomes will be recorded separately when available.

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

## First qualification attempt — in progress

The first preparation attempt stopped on a CocoaPods tooling conflict, addressed
by the isolated wrappers above. The second stopped because the signing chain
lacked the official Apple G3 intermediate. That official intermediate was
retrieved, its chain checked, and added to the user's keychain without a custom
trust override. The existing Apple Distribution identity then passed its signing
identity check; no new distribution certificate or replacement profile is claimed.

The third local attempt has passed credential preparation, native dependency
installation/prebuild and Xcode configuration, and reached Metro bundling. It
has not yet produced a verified STORE archive or a local-binary TestFlight
result. Retain this distinction when reporting progress or updating the gates
below. The successful cloud build 64 remains the verified distribution fallback;
its acceptance is not evidence about this local attempt.

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

- [ ] Local dependencies and production environment qualified.
- [ ] Local compilation completes and produces the expected IPA.
- [ ] Actual archive signature/APNs/content and source provenance verified.
- [ ] Cloud-build IDs compared before/after; no new compilation job attributed
      to this local attempt. Preserve the command/log evidence of the local path.
- [ ] Verified local IPA submitted and accepted by Apple.
- [ ] Build available in the existing private owner-only TestFlight group.
- [ ] Owner accepts the focused iPhone recipe on that exact local binary.

Retain private attempt evidence outside Git in workspace
`maintenance/local-ios-build/`. Record source SHA, actual tool versions, local
command, native number, archive checksum and each observed delivery state. Never
retain raw credentials or a fabricated `FINISHED` cloud-build JSON as provenance.
A comparison of build IDs supports absence of a new cloud job; account reads,
version allocation or a submission record are separate operations.

This record preserves the existing successful TestFlight delivery as a rollback
reference. It does not reopen accepted M0–M8 tests, authorize a paid fallback or
require a build/deployment for documentation-only changes.
