# V1 — grouped compatible API delivery, 24 October 2026

State: **API promoted and health/authentication boundary verified**. Native delivery, authenticated business acceptance and V1/M8 acceptance remain separate.

## Exact artifact and gates

- Source `4bbbeb143e3caa5870b1d73b7ed184ef9ba06015`; tree `22ba0e56766b1303cfaee4ffd874fc15abcb13cc` matches the reviewed PR-364 head `7e0fdc1`. Both exact-head CI runs `40069245204` / `40069260111` passed **5,038 tests / 6 skipped**, API bundle and iOS/Android exports. Master run `40069948026` passed separately.
- Clean source archive: all **1,765 tracked blobs** compared to Git object hashes. Project-link metadata is the only additional configuration. No environment file pulled, dependency upgrade, local source workaround, database migration change or provider activation.
- Intended project `prj_zHAHcfqYnnRixxvjxFSmfKzSjWTN`, team `team_7CGAetNCA5DbQyP3yNVHgnt4`, root `apps/api`. Existing Fastify project context read back before deployment. Git-triggered deployments/bot policy unchanged.
- One production artifact created with domain assignment skipped: `dpl_B1QDr8HVPk8omeuictVhRncVptQi`, `https://fl-copilot-9adzvhp8m-julien-3666cb71.vercel.app`. READY/production/project/source/tree metadata checked. The public alias still resolved to the previous artifact before promotion.
- The same tested production artifact was promoted without reconstruction. `https://fl-copilot.vercel.app` resolves to that exact ID/source after promotion.

## Scope and checks

This groups current conflict/comparison protections, source-scoped transcription review, visual-library reads/comparisons and reviewed image actions, including attached STORE_PHOTO copies. New actions remain conditional on trusted compatible native capabilities. Old client capabilities remain supported under the existing tests; a new server does not add newer native cards to an installed old binary.

Staged `/health` returned 200 with `status:ok` and `database.status:connected`; sync bootstrap and a private visual-file manifest refused requests without an application session with JSON 401 `AUTH_REQUIRED`. Public health and unauthenticated bootstrap were checked again after promotion. Vercel protection authentication used for the staged checks is not an application principal. No OTP/session was invented and no business operation was executed.

The first health verification script incorrectly expected a flat `database` string. The unchanged actual route/shared contract uses `database.status`; the assertion was corrected and the staged checks rerun. This was a probe-format error, not a runtime failure or reason to deploy again.

Private operational records and raw CI/build/promotion evidence are retained in the task's releases/artifact folder. No paid AI test, receiving-key creation/change, new native build, product/image import or full physical acceptance is claimed.

## Rollback and remaining gates

Previous production `dpl_J8GundEHU4dF1yEg4Fv5XSwyhKzR` / source `4941513bc28de0a0f8494f88575c0e531dc7d0aa` is retained. Roll back through Vercel's existing promotion/rollback mechanism only if needed; preserve every original, pending command and durable job. Restore a compatible API before later native capabilities are accepted; never reset the phone to conceal a mismatch. No rollback was exercised against real data.

iOS build 14 (`7e46885`, EAS `eabbf760-49d8-4161-9e40-e16a63f02403`) remains finished/available; owner installation/acceptance is still unconfirmed and build 13 remains its predecessor. The memory-suggestion correction under current native verification is outside this API artifact and needs no API change. The new image pilot still lacks final images/provenance/session/review and actual mobile acceptance. Resend authorization, second-device restoration, measured plan/mobiles, approved illustration provider/budget, actual expert dialogue/advice loop and iOS/Android M8 remain open.

Seven M7 workstreams remain **1/3/4/5/6/7 IN_PROGRESS; 2 CODE_READY**. This delivery makes the compatible server available; it does not close those gates or redefine the complete V1 goal.
