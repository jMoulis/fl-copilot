# M7 — original PDF to a reviewed chat offer

## Scope

This activation follows the compatibility baseline in PR 374 (`12dcfbe`). A capable native chat advertises both source format 2 and choice-creation capability 2. The existing `commercial_choice_create` tool then accepts an original page/excerpt plus proposed product, dates and complete mechanism. There is no alternate business writer, fake extraction row, automatic approval or new database model.

The model cannot supply an original checksum. The server binds it from `commercial_pdf.documents`, populated only when actual authenticated PDF bytes have been delivered to that same generation. Executing a metadata read without delivering its file is insufficient. Unknown originals or nonexistent pages create no choice proposal; an early attempt receives a read-first response and can recover after reading the original. The current source metadata, active product, units, terms, dates and duplicate protections still pass through the existing preview and canonical sync validators. Document contents remain untrusted data.

The private version-1 proposal envelope is preserved deliberately: the baseline already understands the new explicit `PDF_ORIGINAL` source kind, so it can read these records during rollback. Legacy extracted coordinates, identity and proposal input stay unchanged for capability 1. Unsupported or missing source format never activates the new tool input.

The native card shows the proposed business facts, the original excerpt and its existing private original-file action. A manager explicitly confirms critical conditions and applicability before the existing controller/runtime commits the choice and Outbox atomically. It does not leave the chat for a full-document review. Callback cancellation and a generation fence prevent a late result from a previous card/account context changing the current card.

## Workflow budget

The initial eight-step allowance described below applies to eager catalogues. The subsequent deferred-discovery correction is tracked separately in [its QA](M7_ORIGINAL_OFFER_DISCOVERY_2026_10_24.md); it is not yet a claim of that API delivery.

The old allowance of five total tool calls, three/four distinct reads and four steps can interrupt a three-offer request before the final proposal. Original-choice-capable turns now have a bounded allowance of **seven reads and eight steps**, derived from one original, three product resolutions and three offer proposals plus the final answer. Other turns retain their previous allowances. Response evidence bounds cover the maximum; configured byte, PDF, output-token and timeout limits remain unchanged. No model/provider change or paid test is implied.

## Observed local evidence

- Installed Responses transport, with controlled HTTP replies: original bytes → future offer → canonical preview, both ordinary and streamed; early proposal → read original → retry also finishes. Raw model arguments contain no approval, confidence or original checksum. No extraction tool runs.
- Three genuinely represented synthetic offers are resolved and proposed with serial tool calls. The test fails when the previous resource limits are restored and passes with the workflow allowance; the temporary reproduction restores the implementation byte-for-byte.
- Actual Mongo/SQLite flow now includes the real source preview, private proposal builder, synced private-record reducer and native confirmation controller before Outbox/Mongo, restart, original restoration on a second SQLite, validation, preparation and future plan. Repeated confirmation creates one choice. Missing review and a forged displayed card are rejected. Manager decisions are explicitly simulated test actions, not owner approval.
- Native mounted card: excerpt/original action, explicit confirmations and late-result cancellation across contexts. Negotiated HTTP and ApiClient header tests preserve legacy behavior.

Full check, exact CI, release identity and physical acceptance are recorded only after observation. The compatibility baseline must be verified as a deployable minimum rollback before activation is released. No paid EAS build or real model request has been made for these tests. Full V1/M8 acceptance remains open.

Automatic background document extraction is still queued by the existing upload path. Reading and retaining an original offer no longer waits for it; this increment does not introduce a new extraction scheduling policy.

Local final check: **4,471 passed / 727 environment-dependent skips**, ten strict TypeScript projects and zero-warning lint/structure pass. Focused actual Mongo/SQLite, installed SDK, native runtime/card and response-grounding regression: **75 tests / 7 files**. API bundle build/import pass; exact CI, API delivery and grouped native acceptance remain subsequent gates. No real model call or owner business approval is inferred.
