# M7 — document source links without repeated passages, 24 October 2026

## Observed problem and reproduction

A scoped read of the current active owner/store conversation shows a week-44 PDF answer whose table rows repeat a complete observation immediately before their source link. The same observation about fruit merchandising and another offer is appended to more than one row. The document's commercial accuracy and the phone's installed version were not independently established by that read.

The defect is reproduced in the existing original-PDF fixture: `{{document:0}}` always expanded to both the observation value and source, even when the narrative already paraphrased the passage. The before-fix test fails because an unrelated second clause is injected into each table row. This is a deterministic formatter defect, not evidence that the model itself cannot also repeat text.

## Correction and compatibility

During generation, `{{document:n}}` now binds only the source link. An explicit `{{document-value:n}}` binds the passage/value plus its source when the text, such as a price, actually needs insertion. Only the two existing local tool/output descriptions explain that distinction; no global instruction, new tool, agent or model is added.

Both forms resolve through the same generation-owned original/page/checksum evidence. Existing fact indices remain stable; source observations retain `SOURCE_INSTRUCTION` and the unvalidated AI-reading qualification. The ordinary answer renderer still refuses raw numeric prose and model-authored URLs, and the existing fact/data/PDF/read/step/token/time limits remain unchanged. This does not approve a commercial offer, assert a store KPI or execute a business action.

Malformed, unknown and incomplete document references remain rejected or withheld during streaming. Clients receive the existing rendered text/source contract. No schema, migration, persisted-message rewrite, native capability, provider, dependency or business writer changes. Only new answers use the changed binding.

## Verification and delivery gates

- The observed table pattern fails before correction and passes afterward, without removing its source observations or links.
- Six new cases extend the existing fixtures: table citation without forced text; explicit numeric insertion and source-only reuse with prior fact indices/raw-number rejection/fact cap; both partial-reference forms; and source-only classic/SSE Responses transport.
- **271 targeted tests / three files pass**, using the installed SDK with controlled transport, plus the unchanged answer renderer and complete deferred-tool/offer workflow. No paid model call was made.
- Full local check: **4,498 passed / 727 environment-gated skips**, ten strict TypeScript projects, lint/structure, format and API build/import pass. Exact final push and PR CI, native exports and separate master CI are required before an API release.

This is API-only and compatible with the existing available iOS build 16. No EAS build is needed. Current API remains PR 379 until the next explicitly checked deployment; actual new-answer quality and the complete V1/M8 recipe remain open. PR 380 is merged (`b79be54`), both exact gates and master **5,213 / 6**, branch deleted; its reminder changes and PR 378 remain native-pending. Seven workstreams stay **1/3/4/5/6/7 in progress; 2 code ready**.
