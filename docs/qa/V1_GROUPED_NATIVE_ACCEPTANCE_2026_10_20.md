# Grouped V1 native acceptance — 20 October preparation

Status: grouped API released; iOS build submitted and device acceptance pending. Full V1/M7/M8 remains open. This recipe groups already merged work rather than waiting for or omitting the remaining Resend/illustration/other roadmap commitments.

## Authoritative baseline rechecked

- Production API alias `fl-copilot.vercel.app` points to deployment `dpl_8wxufurZhFMng4GU8bvEyT96WKDi`, created 17 October. CLI inspection confirms Ready, production, the correct project and aliases; public `/health` returns 200 with database connected. The recorded source of this deployment is `efc49a468b3e6441c50486db8c8fb17e228e389d` (PR 210); inspection does not by itself add new source-provenance proof.
- Latest finished iOS artifact is staging build `ff8a26ba-49ce-4733-bead-0f4a9b69235a`, commit `d0b40ca9c1d1e5a7f4d738f837d546eb6677fffa`, created/completed 17 October, version `0.1.0`, native build `1`. This is the latest available artifact, not a remote inspection of the installed iPhone.
- Current master at preparation is `5bcb752ba86b2d24b73f482adaa80193ba257018` (PR 287). Its push CI `39361562797` succeeded. The PR head's push/PR checks both succeeded: 2,992 passed / 6 skipped with real Mongo and native exports. A later release-preparation merge must be checked separately.

## Release gate

1. Keep the unfinished Resend branch separate. Only a clean, identified master with exact-head required checks can be released. Verify the intended Vercel/EAS project, scope, current production predecessor and existing queued/running builds before mutation.
2. Stage the compatible production API, verify JSON health/database and relevant authenticated behavior without paid AI calls, then promote the same verified artifact. Keep the prior deployment. Do not enable mail receiving or change provider configuration as a side effect.
3. After API readiness, one internal iOS staging build is justified for the substantive native UX/media/original-sharing acceptance below. Confirm the target remains the existing physical iPhone registration; do not create credentials or provisioning changes without evidence/authorization. Do not create duplicate builds for an already queued/running matching commit.
4. Staging increments the remote native build number. Record the actual resulting version, source SHA, build ID and install link; never call an artifact installed/accepted from `FINISHED` alone.

## Phone recipe after delivery

- Update the existing app, retaining its database and original files. Do not uninstall or erase data for this recipe. Start the standalone staging app without Metro.
- Navigate Aujourd’hui / Analyses / Produits / Copilote / Actions; verify French labels, dark contrast, keyboard, visible return/close alternatives and no layout overflow. Keep an unsaved form safe when navigating.
- In Analyses, explore a real populated week, month and year, inspect comparison periods/coverage, drill down and return. Change tabs and verify the selected period, filters and list position remain. Missing data must not become zero.
- In Copilote, verify a real existing conversation and useful request, streamed response/tool progress, tables/sources, copy/context menus and the return-to-latest control. Review proposed changes before execution; do not fabricate pilot data for testing.
- In Produits and linked analysis/action/chat surfaces, verify a known approved image or placeholder, explicit image association/review and the existing catalogue-edit return flow. Check Photos permissions and cancellation without losing the existing image.
- Add an appropriate real department photo through the explicit photo-of-department entry, inspect upload state and the original; it must not become a waste receipt. Real model/photo interpretation quality is a separate manual acceptance, not established by upload success.
- Open a known PDF/XLSX original from its source screen/chat, then invoke a compatible application via the native share sheet. Verify receipt views one at a time and individual-view/whole-source sharing. Close by visible button and native gesture, retaining the underlying list position. Existing local files must remain usable offline; missing-file recovery should show a durable request/retry/cancel state.
- On a genuinely useful reversible pending edit, verify offline preservation, close/reopen and later exactly-once sync after network return. Do not delete the app, fill device storage or introduce production demo records to force this scenario.

## Gates that this first recipe does not close

Physical second-device original/image restoration, Android native behavior, storage exhaustion, uncertain commits, full accessibility/performance/security matrices, recovery/backups and the complete real recommendation/decision/execution/review and measured implantation/illustration paths remain explicit V1/M8 gates. Mail intake remains under development and is not part of this installed-binary claim. Follow later coherent recipes for those requirements; none is removed from the full objective.

Seven workstreams remain: 1 actions/conflicts in progress; 2 counter-promotion code ready; 3 documents in progress; 4 expertise in progress; 5 recommendations in progress; 6 implantation in progress; 7 UX/validation in progress. This release-preparation change advances traceable delivery and native validation; it does not make an entire workstream complete.

## Actual grouped delivery — 20 October

- Exact source: `c8a16987ed6c558b20bd2f52fa761c9095a2982b`, clean detached checkout, matching remote master. Master CI `39363869583` completed successfully after the PR 288 push/PR checks. The unfinished Resend branch is excluded.
- Vercel: verified project `prj_zHAHcfqYnnRixxvjxFSmfKzSjWTN`, team `team_7CGAetNCA5DbQyP3yNVHgnt4`, API root `apps/api`, Node 24. Staged production deployment `dpl_AkaifXtDr139PinPy2W4HQVmeT9o` (`https://fl-copilot-mr3suztuo-julien-3666cb71.vercel.app`) reached READY with the exact source SHA in deployment metadata. Protected-stage health returned JSON with the database connected through the existing authenticated CLI. Source-original manifest, visual manifest and copilot history returned application `401 AUTH_REQUIRED` without an app session. A probe of the nonexistent `/api/v1/copilot/conversations` route returned 404; the actual history route was then checked. These are route/authentication-boundary probes, not successful authenticated business operations.
- Promoted that same artifact without rebuilding. Inspection of `fl-copilot.vercel.app` resolves to the new deployment ID; public health returns 200/database connected, and the three protected app routes still return 401 without a session. Keep predecessor `dpl_8wxufurZhFMng4GU8bvEyT96WKDi` for rollback. First deployment-scoped runtime scan (03:21–03:36 UTC) returned zero error/fatal records with no excluded intervals; this narrow window does not establish long-term stability.
- CLI 39 inspection/linking worked, but upload was rejected before deployment because Vercel now requires CLI >=47.2.2. A temporary pinned CLI 64.7.0, task-local configuration/cache and the existing CLI credentials completed the release. The global installation and Mac configuration were not changed. No `.env` file was read/pulled/written; no AI request or mail-receiving configuration was introduced.
- EAS: rechecked five most recent iOS builds, all finished and predating this source; submitted one grouped standalone/internal staging build with pinned temporary CLI 24.8.0 and `--freeze-credentials`. Existing provisioning includes iPhone Air. Build `dd32fb48-c423-4ab7-a444-fe0fb4e0de0e`, source `c8a1698…`, version **0.1.0 / native build 2**, created `2026-10-20T03:36:23.433Z`, initial status NEW. No completion or installed-device acceptance is claimed. Build page: https://expo.dev/accounts/julesmoulis/projects/fruits-vegetables-copilot/builds/dd32fb48-c423-4ab7-a444-fe0fb4e0de0e

The complete phone recipe and remaining V1/M8 gates above still apply. Update the existing application rather than uninstalling it. Receipt of a finished binary is distinct from validation on the owner's phone.
