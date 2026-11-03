# M7 — product codes available without a second fiche read, 3 November 2026

## Current observed gap

The latest owned conversation contains two unsuccessful requests to add PLUs to the existing weekly draft (3 November, 03:43 and 04:42 UTC). The second reply was generated on API `fe57a80`; its retained provenance records four successful product searches but is incomplete. Runtime STEP/END records show seven completed model steps and 13 tool calls, with a completed HTTP 200 response. They do not identify the arguments or precise reason of each unavailable tool. No claim is made that all failures were caused by the read budget or that the PDF service is broken.

Read-only current catalogue checks find the two named products, with validated ITM8/EAN identifiers and **no explicitly stored PLU** for either. Do not derive a PLU from an EAN, strip zeros, rename one identifier type as another, or create a source/approval. A successful full fiche read could establish this; the existing product_search only returned product identity/classification and required another tool call to inspect its codes. Repeating that per product can exhaust the bounded workflow before preparing the requested draft update.

## Small existing-tool correction

Keep the same search input, matching/ambiguity decisions, permissions and read budgets. Candidate results optionally include validated identifiers as compact type/value pairs plus identifiersComplete. Both fields absent is a legacy unknown; true with an empty list establishes no validated code; false with an empty list reports a bounded read, never absence. The result schema rejects unpaired fields and partial lists presented as unavailable.

Read at most 21 current validated rows per returned candidate (five candidates maximum, 20 displayed codes per complete list). Each lookup is store/product scoped, excludes deleted/unreviewed rows, uses the existing identifier serializer and has the existing two-second query bound. A product with too many codes cannot hide another candidate's complete list. No other product, alias or inactive candidate is exposed. Identifier records/versions enter the evidence digest; historical replies are preserved and fresh reads detect code revision changes. The existing product fact contains the code strings and coverage, without adding evidence records.

Replace the existing product_search description to explain direct code reading and coverage. No global instruction block, tool, database model, migration, business writer, model/provider change, retry increase or budget increase. Editing product identifiers still requires the existing full INSPECT snapshot and native review. Reading codes grants no write authority. A qualitative draft can use existing note/theme fields; no fake promotion is needed.

## Verification and limits

- 57 targeted domain/Mongo tests across three files, zero skips: real isolated transactional Mongo, owned validated codes by label and exact code, leading zeros, ambiguity preserved, empty lists, foreign/unreviewed/deleted codes, per-product overflow, changed identifier revision and existing fact-context checks.
- 245 provider tests pass with installed AI SDK 7.0.130 and scripted Responses transport. The new scenario exposes four compact product-code results and one existing draft read within the unchanged five-read allowance; the fiche inspection callback is not invoked. This is a controlled transport proof, not a paid model-quality test or billing measurement.
- Full structure/lint/typecheck/tests and exact-head CI are recorded separately. No production data was written and no live model request was made. Production logs also contain a MaxListenersExceededWarning; its cause is not established or masked by this increment.

## Delivery and acceptance

Server-only: the existing iPhone build 24 remains suitable; no new EAS build. API release follows exact-head push/PR checks, merge/master validation and the normal staged-then-promoted artifact. Until that release, production behavior remains unchanged.

After release, retry the owner's request to annotate the saved draft with the intended products' codes. The assistant should use available typed codes, clearly distinguish a missing stored PLU from unavailable reading, and prepare only the requested draft change for review. It must neither fabricate codes nor claim a change was saved before confirmation. Actual model behavior and the original failed workflow remain open until that retest.

Advances M7 workstreams 1/4. **1/3/4/5/6/7 ongoing, 2 code ready.** Accepted weekly UX and M0–M6 functional iPhone baseline remain closed. Build-24 history acceptance and the real advice/choice/execution/review pilot remain separate.
