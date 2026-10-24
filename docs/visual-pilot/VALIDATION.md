# Visual pilot — validation status

**Production: BLOCKED, zero application writes.** No approved product image has been imported. No production manifest/file acknowledgement or real mobile acceptance is claimed.

The handoff was read starting with README and AGENT_IMPLEMENTATION_BRIEF. The opaque composite is reference only. A read-only catalogue audit found the manual banana conflict and unresolved avocado SKU. See AUDIT.md and the private candidate manifest.

## Automated proof scope

`apps/api/test/visual-pilot.test.ts`: actual synthetic PNG decoding, SHA-256/alpha/evidence, missing inputs, strict incoming schema, path traversal/symlink/reference/opaque rejection, provenance/transform chain, manager/exact product/manual/tombstone checks, human-review gate, generic-only association, unchanged approved input, actor scope, stable command retry, first-mobile gate, compatible approved-AI reuse, refusal to relabel user uploads, conflict ACK and unexpected upload host.

`apps/api/test/visual-pilot.integration.test.ts`: isolated replica Mongo and Fastify routes, shared ApiClient, canonical sync/file services, controlled private storage, lost acknowledgement after commit, immutable identity/asset/link readback, actual original/preview checks, mobile SQLite bootstrap/pull, visual-file jobs/cache and restart. Generated colored-pixel test fixture is **not AI imagery**, simulated review callbacks are **not human approval**, controlled storage is **not live Vercel Blob**, and SQLite is **not a physical phone**. Test databases are disposable and dropped.

Existing visual route/auth, file, metadata/device and native cache tests remain relevant. No production credential or paid provider request is used. Exact executed checks/results are recorded with the delivered branch and private verification report; do not substitute tests for the production gates below.

## Executed local verification

- `pnpm check`: structure, lint, all 10 strict TypeScript projects; **4,327 tests passed, 717 skipped** because optional integration environments are absent in that run.
- Targeted visual suite with disposable transactional Mongo replica set: **93 tests passed across 13 files**, including the new HTTP → Mongo → SQLite/cache/restart proof. No targeted tests were skipped.
- Actual supplied candidate preparation: all three explicitly `BLOCKED / PILOT_IMAGE_MISSING`; no network or mutation.
- `git diff --check`: passed. CI, merge and delivery status remain separately recorded; no EAS or Vercel deployment is implied.

## Required real gate, still pending

| Gate                                                                | Status       |
| ------------------------------------------------------------------- | ------------ |
| Three individual final files + truthful generation evidence         | MISSING      |
| Exact tomato SKU + actual human approval                            | PENDING      |
| Genuine manager application session                                 | MISSING      |
| Tomato canonical command/file/manifest production readback          | NOT STARTED  |
| Real identified mobile synchronization, display and offline restart | NOT STARTED  |
| Existing manual images unchanged on device                          | NOT VERIFIED |
| Banana manual-link resolution by authorized user                    | BLOCKED      |
| Avocado exact compatible SKU confirmed                              | PENDING      |
| Remaining two imports after first mobile acceptance                 | NOT STARTED  |

No hash, file size, approval actor/time, screenshot, provenance or successful integration is filled from assumption. The first missing prerequisite is reported instead of bypassed. Current preview is JPEG on white; RGBA transparency applies to original only.
