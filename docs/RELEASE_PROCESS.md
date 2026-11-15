# Release process

## Current owner policy — local iPhone builds, 15 November 2026

Compile iPhone releases on the owner's Mac by default. The owner withdraws the
standing authorization for paid EAS cloud compilation granted on 3 November.
Do not start a paid EAS cloud build without a new explicit owner agreement for
that build. If local compilation is unavailable, identify the actual blocker and
prepare a concrete alternative before asking; never fall back to cloud silently.

This restriction applies at least until the planned budget renewal in early
December 2026. The renewal date does not itself restore the former authorization.
An existing successful cloud build may still be inspected or submitted; those
operations do not authorize a new cloud compilation. Do not build or deploy a
documentation-only change.

Keep Expo, the existing production profile, remote native version numbering,
Apple signing/APNs and private TestFlight distribution. Local compilation changes
where the archive is produced, not the application architecture or distribution
scope. EAS authentication, existing credentials and version/environment services
may still be used; `--local` is not a claim of fully offline operation.

The first local STORE archive is **being qualified**, not declared successful or
accepted on iPhone. Read [the local-build qualification record](qa/LOCAL_IOS_BUILDS_2026_11_15.md)
for source/toolchain checks and the distinction between a local archive and an
EAS cloud build record. The previous verified TestFlight binary remains available
while this qualification is in progress.

## Delivery policy — 17 October 2026

The owner approved reducing build consumption by grouping releases. This supersedes the previous requirement to build a Vercel preview and immediately deploy production for every atomic PR.

- Keep the existing GitHub foundation checks (lint, typecheck, unit/integration tests, formatting, API build and mobile export). Both exact-head push/PR checks must succeed before merging.
- Do not require a Vercel deployment/check for every PR. Merge reviewed changes into coherent batches; report merged-but-unreleased work accurately.
- Automatic Git-triggered preview and production deployments are disabled for the `fl-copilot` Vercel project. `apps/api/vercel.json` also sets `git.deploymentEnabled: false`. Bot comments remain disabled. Existing production remains online.
- Create a protected preview explicitly only when remote behavior or a requested acceptance test justifies it. A preview is optional; use local and GitHub checks for ordinary changes. Do not disable preview protection.
- Release a coherent tested batch from a clean exact `master` SHA through the authenticated CLI or REST API. Verify the intended project/team and current exact-head GitHub checks. Record the released SHA and changes since the previous production deployment. Do not deploy documentation-only or mobile-only changes unless the deployed API needs them.
- Prefer a staged production deployment with production environment configuration, test its JSON `/health` and relevant behavior, then promote that same deployment. Do not separately rebuild an already-tested staged production artifact. Confirm READY, the intended SHA and the public `fl-copilot.vercel.app` alias, then verify public JSON health with database connected.
- Preserve the previous deployment for rollback. A successful merge is not evidence of a production release; do not claim native acceptance from an API deployment.
- Historical owner update, 3 November: more frequent paid iPhone builds were authorized for smaller coherent acceptance batches. That standing spending authorization is superseded by the 15 November local-build policy above. Keep the short device checklist, exact-head checks, API compatibility and build identity requirements; they never require a new build for test/documentation-only changes or authorize paid AI calls.

The project deployment-source policy denies automatic `git` deployments for both system preview and production environments. Explicit CLI/REST releases remain separate. Read back the project settings after changes; do not trigger a billable build just to prove automatic builds are disabled.

Official configuration reference: https://vercel.com/docs/project-configuration/git-configuration

## Grouped native build identity

The staging/internal and production profiles use the existing remote app-version source and increment the native build number for each new native build, including local builds. A fresh staging binary must have a distinct native build version: consecutive binaries previously reused `0.1.0` / build `1`, making installed-version checks and the default Sentry release/dist harder to distinguish. This does not start a build or change the Mac toolchain.

For a grouped acceptance release, record the exact source commit, build location,
profile, app version, native build number and verified archive SHA-256. For a
cloud build explicitly authorized under the current policy, also record its EAS
build ID. A local archive has no EAS cloud build ID; preserve local logs and
archive provenance without inventing a remote record or reusing another build's
identity. Verify the API-compatible release first and retain its predecessor for
rollback. A finished archive is not proof of Apple processing, tester access or
physical iPhone acceptance. The current application version remains `0.1.0`; the
build number identifies the binary iteration.

## TestFlight pilot target

The production submission profile targets the private App Store Connect record `6833595029` (FL Copilot, French locale), existing bundle identifier `com.flcopilot.mobile` and team `54QQCYMGXT`. These identifiers are not secrets. Reuse the existing EAS submission credentials; never commit keys, passwords or session files.

Submit a verified STORE-distribution archive by its exact local IPA path and recorded checksum, or by its exact EAS build ID when that cloud compilation was explicitly authorized. Keep automatic TestFlight tester setup disabled. Keep the owner-only internal pilot group explicit; do not invite other account members or enable a public link by default. Record EAS submission success, Apple processing and actual owner TestFlight access separately. Uploading the beta archive does not authorize public App Store release.

This submission metadata does not change the already-built native code or require another EAS build. Build45 phone acceptance remains attached to its original source and the corresponding STORE archive retains its own build number/source.
