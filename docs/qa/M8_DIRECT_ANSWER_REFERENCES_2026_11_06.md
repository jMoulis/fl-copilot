# Direct answer references and independent titles — 6 November 2026

## Owner feedback and actual incident

The owner rejects the latest monthly retest and asks to simplify rather than accumulate patches. The expert completed three steps in 61,416 ms with no read failures, then final validation returned `UNKNOWN_EVIDENCE`. That existing code also wraps renderer failures; the exact rejected fragment is not retained and cannot be reconstructed from these logs. Separately, the light dispatcher timed out after 4,007 ms, so no title proposal existed. These are not proof of missing data or insufficient output tokens. Observed expert input is 123,287 tokens (59,789 cached tokens included); failed dispatcher usage is unknown. No cost/quality acceptance is claimed.

## Replacement model contract

The model now writes its narrative using direct `{{value:REF}}`, `{{label:REF}}`, `{{source:REF}}` and `{{chart:REF}}` markers. It no longer copies a fact array or counts narrative indexes. It also no longer generates language, summary, interpretation and question metadata: the application supplies the existing French envelope, with interpretation/questions expressed naturally in the narrative. Eligible deterministic recommendation cards and PDF observations retain their existing scoped contracts.

The existing model adapter constructs the canonical fact list, deduplicates used facts and rewrites the direct markers to the unchanged stored/native index format. Initial evidence gets short generation-local aliases, while candidate/product/document IDs remain canonical. New read evidence retains existing budget/conflict checks; rejected reads and foreign generation references cannot be resolved. Initial facts do not inflate the adaptive analytical-read counter. Original values, source hashes, units, charts, store authority and native contracts remain unchanged.

An unknown reference removes its whole paragraph or table, never an individual number. After original-PDF binding, the existing renderer checks each remaining block: malformed markers, unverified literal figures and invalid chart references are locally omitted with one explicit French note. Other renderer/programming errors and ambiguous evidence still propagate. The response is qualified as partial, not reported as fully verified; content-free omission counts distinguish reference and renderer failures. No invented replacement values, silent omission, source substitution, extra model call or repair agent. The existing fact ceiling remains.

## Title independence

After a new answer is durably committed, an absent model title falls back to a bounded plain excerpt of the question only for `Nouvelle conversation`. Empty/greeting-only text is ignored; URLs and control characters are removed. The existing canonical title/history/sync writer still rechecks owner/store/session/deletion, expected title, replay and manual-title priority. Its origin remains AUTOMATIC, with no fabricated model provenance. No additional AI request, title collection, timer or longer dispatcher deadline.

## Validation

**403 tests in ten suites pass, zero skipped**, including 17 real transactional Mongo/SQLite title cases and the installed SDK/provider transports with controlled HTTP responses. Three absent-model-title cases fail against the previous turn service (success, timeout and output-limit), then pass with the fallback. Existing manual rename, unauthorized/deleted scope and replay tests remain intact.

The monthly fixture now emits the direct model wire shape itself. Both streaming/non-streaming cases inject an unknown reference, an unsupported amount, a malformed marker and an invalid chart, while retaining an independently verified valid chart and the safe table/prose. Actual rendered message/source validation succeeds; omitted blocks are explicitly qualified and unverified text does not survive. The old fixture unnecessarily copied 96 facts while displaying twelve: only the twelve used facts (thirteen with the chart) are now constructed server-side. A shared test-only translator migrates older transport fixtures; public/native response fixtures keep their old format. Numeric/source validation of canonical stored responses is not weakened.

The prior fixture's chart equality could compare two absent charts because realized prices mixed units. This qualification now requires an actual KG-only price chart, includes a missing-quantity day, and asserts that it survives into the rendered answer. Its byte totals therefore differ from the old cost fixture and are not a controlled token-savings comparison. No live paid AI request or production business-data mutation is made.

Workspace strict types, lint, formatting and API build/import pass. The global instruction text is 4,867 characters versus 4,869 before this change. No new model, agent, dependency, database schema, native build or larger budget. Exact-head CI, merge, API release and real owner/provider acceptance remain separate gates; these controlled tests do not establish what the model will answer live or prove a particular savings percentage. Build39 stays compatible. Broader M8 remains open.
