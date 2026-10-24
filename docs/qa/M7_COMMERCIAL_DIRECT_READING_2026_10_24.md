# M7 — direct commercial PDF reading and multiweek source retention

The owner found that commercial discussion depended on the manual extraction/review workflow and could not prepare the following week. The primary `commercial_pdf` tool previously returned only stored, week-scoped extraction. Independently, both the visual prompt and persistence filtered source operations against the ingestion week's date. That discarded future dossiers before a later planning query could select them.

## Change

- `commercial_pdf` now gives the existing Responses model the actual private original PDF, including layout/images, once per generation. Only an exact source ID is required. Confirmed upload and store access remain prerequisites; processing jobs, extraction completion, review and retained offers do not.
- Reuse registered `sourceDocuments`, private PDF storage and container parsing. Check source type/store/deletion, declared size, actual bytes/hash and unchanged metadata after reading; reauthorize the authenticated request. No model-controlled URL/path, signed download URL, original bytes or base64 is added to the read journal or saved conversation.
- Bound a generation to two distinct originals, sixteen pages and twenty MiB total; failed/aborted/oversized/unavailable reads do not authorize observations. These are technical limits, not a calendar restriction. Existing upload limits remain separate.
- Fresh response generation may contain concise `documentReadings` attached to a source/page actually delivered to that model turn. Server binding inserts existing fact/value/source placeholders and labels their provenance as **unvalidated AI source observations**. It does not verify visual quotations automatically or promote them to store KPI, approved terms, applicability or execution. Stored/mobile response contracts remain unchanged. Strict official-figure grounding, literal-number rejection outside placeholders and business approval rules remain in force. Streaming uses the same binding; incomplete/invalid references do not leak template syntax or source authority.
- Existing structured reads remain available as `commercial_pdf_extraction` for already registered extraction. They are secondary, not the entry point for discussing the original. Existing canonical offer/plan tools still own any requested persistence. This increment does not grant arbitrary writes or make an original-file observation a retained offer.
- Visual extraction now retains all weeks on its target page and preserves real sales dates, deadlines and unknown periods. The reference week is temporal context only. Planning/query tools may select the user's requested week at use time. Original records and immutable earlier readings are not rewritten or silently regenerated.

No new database entity, collection, migration, native capability, provider/model, credential or prompt-policy layer is introduced. The existing native attachment path already registers a local PDF and attaches its source ID without waiting for commercial validation. Background processing remains available; this change removes it as a prerequisite to conversation.

## Verification

- The future-operation acceptance test fails with the previous persistence filter: the stored operation list is empty. With the fix, the current and explicit future operation survive in the immutable reading; no offer choice is created.
- Real PDF fixtures exercise original bytes, two source weeks, checksum/container/page count, missing/foreign/pending/deleted sources, source changes during read, cancellation and unchanged originals. The reader consults only `sourceDocuments`, never processing jobs or business writers.
- Installed SDK/Responses transport tests verify actual PDF base64 reaches the model in both ordinary and streamed turns, without calling the extraction adapter. Source observations render prices and automatic citations; a literal unsupported store-CA figure still fails the existing validator. Pixels/bytes are absent from saved response payloads.
- Observation tests reject a source not delivered in the current turn, an unavailable page, malformed/unknown references and incomplete streaming data. An original rejected by the shared read budget never becomes a source-observation authority.
- **309 targeted tests across seven files pass**, including actual transactional test Mongo for visual persistence and existing Copilot response integration. Complete local checks pass **4,436 tests / 721 environment skips**, ten strict projects, lint and structure; exact-head push/PR and master CI remain mandatory.
- Read-only production metadata confirms the latest owner PDF has a confirmed original, five pages and a review-pending processing job. No production job, reading, offer, plan or message is modified by this inspection. No real model request, paid EAS build or physical acceptance is claimed.

Grouped API delivery and a real conversation using the owner's file remain required. Canonical offer application still has its own source/identity/decision checks; this is not a claim that every future commercial write path has completed acceptance. Full V1/M8 and seven-workstream gates remain open.

M7 workstreams 3/4 advance; **1/3/4/5/6/7 IN_PROGRESS, 2 CODE_READY** remain unchanged.
