# Grouped V1 native acceptance — 20 October preparation

Status: preparation only; no release or build is started by this document. Full V1/M7/M8 remains open. This recipe groups already merged work rather than waiting for or omitting the remaining Resend/illustration/other roadmap commitments.

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
