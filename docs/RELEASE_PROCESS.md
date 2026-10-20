# Release process

## Delivery policy — 17 October 2026

The owner approved reducing build consumption by grouping releases. This supersedes the previous requirement to build a Vercel preview and immediately deploy production for every atomic PR.

- Keep the existing GitHub foundation checks (lint, typecheck, unit/integration tests, formatting, API build and mobile export). Both exact-head push/PR checks must succeed before merging.
- Do not require a Vercel deployment/check for every PR. Merge reviewed changes into coherent batches; report merged-but-unreleased work accurately.
- Automatic Git-triggered preview and production deployments are disabled for the `fl-copilot` Vercel project. `apps/api/vercel.json` also sets `git.deploymentEnabled: false`. Bot comments remain disabled. Existing production remains online.
- Create a protected preview explicitly only when remote behavior or a requested acceptance test justifies it. A preview is optional; use local and GitHub checks for ordinary changes. Do not disable preview protection.
- Release a coherent tested batch from a clean exact `master` SHA through the authenticated CLI or REST API. Verify the intended project/team and current exact-head GitHub checks. Record the released SHA and changes since the previous production deployment. Do not deploy documentation-only or mobile-only changes unless the deployed API needs them.
- Prefer a staged production deployment with production environment configuration, test its JSON `/health` and relevant behavior, then promote that same deployment. Do not separately rebuild an already-tested staged production artifact. Confirm READY, the intended SHA and the public `fl-copilot.vercel.app` alias, then verify public JSON health with database connected.
- Preserve the previous deployment for rollback. A successful merge is not evidence of a production release; do not claim native acceptance from an API deployment.
- Paid EAS builds remain reserved for substantial grouped device acceptance requiring owner feedback. No paid AI test requests or provider/environment changes are implied by this policy.

The project deployment-source policy denies automatic `git` deployments for both system preview and production environments. Explicit CLI/REST releases remain separate. Read back the project settings after changes; do not trigger a billable build just to prove automatic builds are disabled.

Official configuration reference: https://vercel.com/docs/project-configuration/git-configuration

## Grouped native build identity

The staging/internal profile uses the existing remote app-version source and increments the native build number for each new cloud build, as production already does. A fresh staging binary must have a distinct native build version: consecutive binaries previously reused `0.1.0` / build `1`, making installed-version checks and the default Sentry release/dist harder to distinguish. This does not start a build or change the Mac toolchain.

For a grouped acceptance release, record the EAS build ID, exact source commit, profile, app version and native build number after completion. Verify the API-compatible release first and retain its predecessor for rollback. A finished EAS artifact is available for installation; only the owner's actual device feedback proves acceptance. The current application version remains `0.1.0`; the build number identifies the binary iteration.
