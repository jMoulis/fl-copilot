# M5 commercial planning

Date: 2026-10-07.

## Scope and dependencies

The pilot user accepted the core M4 workflow and explicit receipt-label memory on iPhone, and authorized starting M5. Follow `docs/specs/IMPLEMENTATION_PLAN.md` M5-T01 through M5-T13 and `COMMERCIAL_PLANNING_AND_PROMOTION_ENGINE_FUNCTIONAL_SPEC.md`.

A received commercial source is not a validated offer, store plan or execution record. No commercial action or official business observation may be inferred merely from capturing a PDF.

## M5-T01 — Local PDF source capture

- Native `Ma semaine` exposes `Importer le PDF hebdo` using the existing document-picker module. Cancellation changes nothing; an unavailable native module shows a build-update message. The browser route explains that persistent capture is native.
- The selected file is copied from the picker to app-owned `Documents/commercial-pdfs/<stable-file-UUID>.pdf`. Original user files are never deleted or modified. Existing destination paths are never overwritten.
- Before metadata registration, capture checks a bounded PDF header, positive size up to the existing upload-contract limit of 100 MiB, complete copied size and a SHA-256 checksum. Full PDF structure, encrypted/corrupt-page handling and page-text parsing belong to M5-T03; the header check does not certify that every page is readable.
- SourceDocument and LocalFileMetadata reuse existing shared contracts and SQLite tables; no migration or new native dependency is needed. Their creation shares an exclusive transaction. Capture date is not a business period: source generation time and business-period dates remain unknown.
- Exact duplicates are checked within that transaction by store, source type and checksum. A renamed identical file retains the first document and removes only the attempt's redundant copy. A modified file is kept separately, with no overwrite or publication; corrected-version reconciliation belongs to M5-T08.
- Persistence errors roll back source/file metadata and attempt to remove only the new app-owned copy. If cleanup fails, an unreferenced copy may remain; neither existing sources nor originals are removed.
- The source list reads SQLite and returns on focus/restart. Documents display `Conservé sur cet appareil` and `Analyse en attente`. The screen explicitly states that commercial analysis comes in a subsequent version.
- This increment creates no upload job, commercial operation, checklist, SourceRecord or Outbox command. M5-T02 will add idempotent source upload and extraction orchestration; captured documents are retained for that later path. Their current local processing state is `PENDING`, upload and sync state `LOCAL_ONLY`.

## Verification and native acceptance

SQLite tests cover restart persistence, store isolation, exact duplicate content, changed sources, transaction rollback, original-file preservation and no premature jobs/business records. Capture tests cover non-PDF selection, header bytes, empty file and malformed checksum rejection. Lint, strict TypeScript, repository tests and native bundle exports must pass before review.

Physical iPhone acceptance is pending after merge and staging build:

1. Select a locally available PDF from `Ma semaine` with connectivity off. A cloud-only file may first need downloading in Files; the app cannot retrieve uncached iCloud content offline.
2. Confirm it appears in the source list with analysis pending.
3. Close and reopen the app; the document remains listed.
4. Import the identical file again; the app reports that it is already registered and the list retains one entry.
5. Cancel the picker; no extra source appears.

Extraction results are not expected at M5-T01. The next increment is M5-T02, followed by deterministic page parsing and structured commercial extraction.

## M5-T01 native acceptance

The pilot user confirmed that the existing weekly file remains registered with analysis pending after the updated build. The alias cancellation conflict was separately resolved following PR #83; it was unrelated to PDF capture.

## M5-T02 — Upload and durable pipeline registration

- New PDF capture now atomically commits source/file metadata and one stable `SOURCE_UPLOAD_AND_REGISTER` local job. No business observation or general sync command is created.
- Before processing source uploads, the queue transactionally registers existing M5-T01 PDFs without a job. Existing jobs are retained rather than duplicated. Their document IDs, checksums and files stay unchanged.
- The existing private Vercel Blob initiation/completion protocol handles transfer, stable upload identity, expired URL renewal, backoff and interrupted claims. Concurrent local triggers still share one active cycle. A lost completion response retries the same source; an already stored binary is not sent again.
- Native sandbox-path recovery searches `Documents/commercial-pdfs` for PDF sources after an application update, and persists the recovered URI. It retains original PDF bytes locally even after remote confirmation.
- Only after confirmed upload does the API upsert one `commercialDocumentJobs` record with stable source UUID, store, checksum, object key and pipeline version `commercial-pdf.v1`. MongoDB migration 12 adds unique source/pipeline and queue-status indexes. Repeated or concurrent completion does not reset an existing job's progress. Failure between confirmation and job registration is recovered by another completion request.
- The existing completion contract's `jobId` carries this durable registration UUID. It is not proof of completed extraction. This increment registers a pending `TEXT_EXTRACTION` intent; the Inngest consumer and actual page processing are subsequent work. It does not replace the canonical Inngest workflow architecture with a Mongo polling worker.
- `Ma semaine` reads source/job states locally while focused: pending transfer, sending, retry, missing/invalid source, and remotely sent with analysis pending. Retry clears local backoff for a valid pending PDF; missing/invalid originals are not retried blindly. New capture triggers ordinary background synchronization, and legacy PDFs are discovered by the normal sync cycle.
- No PDF parsing, commercial extraction or operation publication happens yet. Remote source/file persistence does not yet restore this source list through bootstrap on a fresh installation; commercial-source history and retrieval remain a later increment.

Verification covers SQLite migration from no-upload-job sources, one stable job, completion-response loss, explicit retry, permanent file errors, local retention, and no Mercalys verification for PDFs. API tests cover confirmation-before-registration, repeated completion, preserving job progress, store isolation and interrupted registration. Isolated MongoDB tests cover concurrent completion with one workflow and the new migration.

Native acceptance after merge/build:

1. Keep the previously imported PDF; do not delete or reimport it. Reconnect and synchronize.
2. In `Ma semaine`, confirm `Document envoyé` and `Analyse commerciale en attente`.
3. Import an already-downloaded PDF offline, close/reopen, then reconnect or choose `Envoyer le PDF` / `Réessayer l’envoi`.
4. A confirmed PDF remains listed and does not enter another upload cycle. Offers and page text are not expected yet.

## M5-T02 native acceptance

The pilot confirmed `Document envoyé` and the subordinate analysis-pending message for the retained weekly PDF. Its pending processing registration was verified in MongoDB. Transfer is accepted; a confirmed transfer is not an extracted or validated commercial plan.

## M5-T03 — Deterministic PDF pages and Inngest execution

- Inngest was provisioned and connected to the existing `fl-copilot` Vercel project on the Hobby (Free) plan after the user accepted Marketplace terms. `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` remain server-side; local environment snapshots and project linkage are ignored by Git.
- The signed `/api/inngest` endpoint is hosted by the existing Fastify/Vercel handler. Both keys are required to enable it. Unsigned execution is rejected; this endpoint uses Inngest signatures rather than mobile bearer authentication.
- Upload completion sends a source/store identity event with a stable ID after durable job registration. No PDF bytes, extracted text or commercial values are placed in event or step result payloads. A five-minute Inngest recovery schedule picks up previously registered or interrupted jobs, including the pilot's existing file.
- Event execution is limited to two concurrent extraction steps; recovery is limited to one coordinator. Each recovery pass selects at most five eligible sources. Processing uses a five-minute CAS lease, per-attempt token, and bounded backoff for temporary failures. Expired claims are recoverable; stale claims cannot overwrite newer job completion.
- `pdfjs-dist` 6.4.299 reads immutable original bytes remotely. The processor verifies the registered SHA-256 checksum and source/store identity before extraction. Limits are 100 MiB, 100 pages, 200,000 text characters and 20,000 spans per page, and 3,000,000 total text characters. Full raster rendering and OCR are not implemented here.
- Every page retains its one-based source number, text, dimensions, rotation and ordered text spans with original PDF transforms/direction. The text is source evidence, not normalized offers: prices, strict `<`, dates and column spans are not interpreted as business mechanics.
- A page without extractable text remains present with `NO_EXTRACTABLE_TEXT`. Scanned image text is not guessed. Encrypted, malformed, over-limit or mismatched sources receive explicit job error codes; temporary storage/database failures retain retryable intent.
- `commercialDocumentPages` is insert-only, with stable UUIDs retained on retries and unique source/parser/page identity enforced by Mongo migration 13. Parser identity is `pdfjs.text.v1.6.4.299`. Partial writes do not duplicate pages on recovery. Originals, source metadata and published business data are not modified.
- Successful jobs become `TEXT_READY` / `AI_EXTRACTION`, with page and text-page counts. This is the boundary for M5-T04; no AI extraction, offer publication or official KPI change occurs yet.

Verification: actual synthetic PDF parsing (literal text, French accents/euro symbols/decimal commas, geometry, blank page, invalid source and page limits); signed route rejection; strict TypeScript/lint/repository tests; real MongoDB concurrent claims, checksum failure, expired-lease restart, stable pages and transient retry; API and iOS/Android exports. The existing real-Atlas concurrent transaction test uses a 20-second budget rather than the unit-test default of five seconds.

Cloud acceptance remains pending after merging/deploying this PR: verify that Inngest registers both functions and processes the retained pilot PDF to `TEXT_READY`, or returns a specific source-reading error. No native UI change is included; the current app continues to say analysis pending because commercial offer extraction is still subsequent work. No reimport or native rebuild is required just to execute this backend stage.

## M5-T03 cloud acceptance

PR #85 was merged and production deployment readiness verified. The signed production Inngest endpoint reports authenticated cloud mode and two functions. The retained pilot PDF reached `TEXT_READY/AI_EXTRACTION` on its first attempt: eight pages, all with extractable text, 16,779 source characters, and no page warnings. Source references and immutable page rows were checked in MongoDB. No reimport or native rebuild was required.

## M5-T04 — Source-anchored commercial AI proposals

- AI SDK 7.0.130 uses the existing authorized Vercel AI Gateway/OIDC path. Default model `openai/gpt-6.1-sol` was verified against the live Gateway catalog; it is configurable for new documents through server-only `COMMERCIAL_PDF_AI_MODEL`. Receipt extraction is unchanged.
- A strict shared Zod schema, `commercial-draft.v1`, covers source operations, offers, execution/communication instructions, merchandising/TG, market signals, preorder/delivery windows and applicability. Fields retain literal raw values, confidence and cited page/span indices/quotes. Seller prices/customer benefits and supplier conditions remain distinct fields.
- Source pages are untrusted data, with no tools or execution side effects. System instructions forbid following embedded prompts, inventing missing fields/years, calculating prices, deduplicating offers, or declaring applicability/planning/execution. `store: false` is sent for the OpenAI provider; tracing/devtools capture is not enabled.
- Extraction runs per target page with bounded first-page/neighbour context, including PDF-space layout hints. Serialized context is capped at 160,000 characters, output at 6,000 tokens, and a model request at 45 seconds with SDK retries disabled. Blank-text pages do not call the model.
- Shared deterministic validation verifies actual cited page/span existence and literal quote/value support. Numeric/word boundaries prevent digits inside another price/identifier from becoming a proposed value. Unsupported blocks are omitted; unsupported/conflicting fields become null with confidence zero and explicit issues. Multiple source identifiers remain strings with leading zeroes. Dates lacking an explicit year remain raw with an uncertainty warning.
- Every retained block and field has `TO_VALIDATE`, regardless of model confidence. AI output is separate from canonical operations, offers, store applicability, planning, execution or official KPI. M5-T05 will normalize mechanisms; M5-T06 will reconcile repeated offers; M5-T07 will add review UI.
- Mongo migration 14 provides unique per-source/parser/schema/model/page cache identity. `commercialDocumentAiPages` stores raw model output separately from anchored proposals, source checksum, model/response/usage, context-page numbers and validation issues. Stable UUIDs survive retries. Completed page proposals are reused without another model call; lost/incomplete calls before persistence may be repeated.
- Per-page CAS leases last 90 seconds; stale claims cannot overwrite newer results. Temporary failures remain retryable, permanent schema/configuration errors stop, and no page makes more than four provider attempts. Configuration/model identity is frozen for the document; changes do not silently mix models into old drafts.
- Inngest adds document/page AI functions, with two concurrent page executions. Page text completion emits an identity-only event, and the five-minute recovery schedule picks up existing text-ready sources. Durable step results contain counts/status only, never PDF text, quotes, raw output or commercial values. Full completion becomes `TO_VALIDATE/DRAFT_REVIEW`; source-reading/AI failures retain specific server codes.

Verification includes source/citation/number-boundary tests, preserved `<`/comma prices/identifiers, duplicate-field guards and omitted-context limits. Real MongoDB tests cover concurrent page claims, completed-cache reuse, blank-page skipping, schema rejection, transient recovery, stable identity, store scope and absence of operational publication. API and native exports pass. Real Atlas auth/transaction round trips use a 20-second test timeout.

A bounded live test on the first pilot page used the authorized Gateway access: model `openai/gpt-6.1-sol`, 15,080 input and 1,376 output tokens, about 21 seconds, six raw blocks and five anchored blocks. One block was rejected by source checks; date uncertainty remained flagged. It wrote no production draft or business record; raw/validated results stayed in an ignored temporary file.

Full-document cloud execution is pending after deploying this PR. Native review/synchronization of draft proposals is not implemented yet; the current app still displays analysis pending. This is a backend increment, so no iPhone rebuild or reimport is needed to trigger the existing PDF. The future review screen must read cached local draft data, not depend on a synchronous remote request.

## Cloud correction — Commercial AI execution time budgets

After PR #86 deployment, the real eight-page PDF started processing. Some pages completed on their first attempt, while denser requests repeatedly failed at about 45,080 ms, matching the application's 45-second generation deadline. Full-document acceptance is not complete.

- Raise the model deadline to 90 seconds and the Vercel function limit to 120 seconds under the existing Fluid Compute configuration. The per-page claim lease becomes 180 seconds, exceeding the entire callback budget; a meaningful invariant test guards the ordering of these limits.
- Runtime budget version 2 provides four bounded provider attempts per budget version while preserving the lifetime attempt counter. Completed cached drafts, raw responses, identity/model/schema and field validation remain unchanged.
- Only legacy unfinished rows without a draft and with temporary/attempt-limit errors receive one recovery window. They move to `RETRY`, which the legacy worker cannot claim as pending work. Schema-invalid/configuration failures and current-budget terminal failures are not automatically revived. A failed source job is reopened only when no permanent failed page remains in the matching cache identity.
- Capture failure category and elapsed time as sanitized diagnostics, without prompts, document text, credentials or provider response bodies.

A bounded live test of page 5 with the same model/schema completed in 73,454 ms: 26 raw blocks, 22 anchored blocks, seven source-validation issues and date uncertainty, 50,623 input and 5,197 output tokens. This test wrote only ignored local output, not production drafts or business records. It confirms the previous 45-second deadline was insufficient for a representative dense page.

Verification covers execution/lease/function budget ordering, legacy unfinished recovery with retained completed drafts/stable IDs/total attempts, and refusal to revive permanent/current-budget failures. Full production completion remains pending after merging/deploying this correction. No native rebuild or reimport is required.

## Cloud correction — Truncated structured commercial response

PR #87 deployment allowed seven of eight pilot pages to complete, preserving earlier cached drafts. The remaining page failed structured-output validation. A bounded diagnostic using the exact input/schema reproduced the cause: `finishReason=length`, 6,000 output tokens, incomplete JSON and an SDK JSON parse error after about 80 seconds. This was a response-capacity limit, not permission to salvage or trust partial JSON.

- Increase bounded output capacity to 12,000 tokens. Allow 180 seconds for generation, 240 seconds for the existing Fluid Compute callback, and a 300-second page lease. Runtime budget version becomes 3; the invariant test still requires model deadline < server duration < lease.
- Distinguish `COMMERCIAL_AI_OUTPUT_TOKEN_LIMIT` from actual schema-invalid output. Partial JSON is never accepted and source/citation/field-validation rules remain unchanged.
- An explicit maintenance retry after confirmed truncation is available through `src/development/retry-commercial-ai-page.ts`. It requires confirmation plus store/source/page arguments, checks the frozen model/schema/parser/checksum and failed older-budget state, and transactionally requeues only an uncommitted page. Completed drafts and newer-budget failures cannot be reset. Automatic schema-failure recovery remains disabled.
- Lifetime attempts and previous error/retry reason remain auditable. The seven existing pages keep their original UUIDs, raw responses and anchored results. No source, proposal validation, operation or official observation is overwritten.

A bounded replay of page 6 with the wider response completed in 85,858 ms: 6,521 output tokens, 26 raw blocks, 21 anchored blocks and six source issues, with date uncertainty retained. Raw/anchored output stayed in ignored local diagnostics; production data were not modified by that replay.

After merge/deployment, use the confirmed maintenance retry for the failed pilot page, then verify full `TO_VALIDATE/DRAFT_REVIEW` completion. No native build or reimport is needed. This maintenance path is not a general automatic revival of schema/configuration errors or human-rejected proposals.

## M5-T04 cloud acceptance

PR #88 was deployed and only the failed page was explicitly requeued. The retained pilot PDF reached `TO_VALIDATE/DRAFT_REVIEW`: eight complete pages, 140 anchored blocks and 37 source issues. The other seven page cache records were compared before/after and remained unchanged. No draft was validated or published. No native rebuild was needed.

## M5-T05 — Deterministic mechanism normalization foundation

Shared Zod contracts distinguish fixed price, strict/inclusive ceiling, threshold price, card benefit, lot and supplier purchase conditions. Runtime-neutral normalization retains the raw inputs, returns `TO_VALIDATE` and refuses unsupported or contradictory syntax rather than guessing. A recomputable offer projection retains the source block index and never edits cached AI responses, citations or source documents.

Explicit French price/unit forms, threshold conditions, card percentage/amount and lot quantity/total are supported. No effective card price, lot unit price or missing purchase unit is inferred. Supplier discounts never become customer benefits. Unsupported wording remains available with an issue; this conservative grammar is not comprehensive French-language interpretation. Missing data remains null and an explicit zero price remains zero.

This increment establishes the shared normalization layer. It does not persist new operational offers, regenerate the eight cached AI pages, or provide the review UI. M5-T06 reconciliation and M5-T07 review will consume this projection; compound/unsupported mechanics require explicit human confirmation. No database migration or native dependency is introduced.

## M5-T06 — Conservative offer reconciliation

Shared candidate contracts and deterministic reconciliation group identical source-anchored offer terms within the same store, document, explicit operation and exact product identity (confirmed UUID, exact identifier set, or exact normalized label). Identifiers retain leading zeroes; fuzzy label matching and product validation are not inferred. Missing operation/product identity keeps occurrences separate.

A detail/recap group retains one terms variant with every source occurrence/citation. Different mechanisms, prices, sale periods, supplier terms or unresolved raw operators/units/prices retain separate variants with explicit conflicts. Missing dates cannot bridge incompatible variants. No corrected document replaces an earlier document; cross-version comparison remains M5-T08. Repeated identical inputs are idempotent and input order does not change the result. Contradictory data for the same page/block occurrence is rejected.

The page-cache adapter projects existing anchored drafts without another AI request, edits or validation. This is a recomputable shared layer for the forthcoming review/persistence path, not an operational-offer publication. No local/remote table is added yet, and no native UI is changed.

A read-only projection of the retained pilot's eight caches found 58 offer occurrences. None was automatically merged: the available operation/identity context did not establish safe duplication. Explicit French source prices now recognize `Moins de`, `le kg`, `la pièce` and the explicit PVC threshold form; seven offer variants normalize. The remaining unsupported/incomplete terms remain raw for review, rather than borrowing units or guessing packaging. These counts describe draft occurrences, not 58 validated offers or 51 erroneous ones.

Verification covers detail/recap citations, changed prices/dates, ceiling vs fixed/inclusive price, card price, supplier conditions, incomplete/raw mechanisms, store/document/operation/product boundaries, unknown identity, replay/order/immutability and contradiction rejection. This increment requires no native build; physical review acceptance belongs to M5-T07.

## M5-T07-A — Offline extraction transcription review

The first review increment exposes the retained AI extraction on the native device, separately from validated commercial offers/store applicability/planning. It intentionally confirms the **transcription**, not an official price, product match, operation or execution.

- Shared review contracts retain stable cached page UUIDs, checksum/source identity, one-based page number, source citations, original fields and extraction warnings/issues. Mongo migration 15 registers immutable `commercialReviewPages`; source registration and the incremental sync change share a transaction. Existing complete caches are backfilled on an authorized capable sync request, without regenerating AI output or editing originals.
- Capability-gated bootstrap/pull (`commercialReview=true`) protects older installed builds from unsupported entity types. Their cursors advance over excluded review changes. The new native client adopts the capability through one fresh bootstrap, including for stores with existing cursors, so earlier skipped snapshots/decisions are restored. Pending local choices are retained.
- SQLite migration 16 adds review pages and decision tables; repositories/serializers, bootstrap/pull, acknowledgement and schema-version tests cover them. Screens read SQLite. No synchronous feature-specific API call is added to render saved content.
- `Ma semaine` shows received page counts and remaining elements, including remotely restored review documents. `Examiner les extraits` opens an item-by-item review with cited text at the top, an accessible enlarged text sheet, original fields, highlighted issue explanations, normalized mechanism proposals and reconciliation conflicts. Page/item navigation and the next unexamined/conflicting element are available. Navigation warns before abandoning unconfirmed edits.
- Unique source fields can be corrected manually (including removing an unsupported value); identifiers repeated within a block remain separate and are not overwritten by a single ambiguous correction. Confirming or dismissing requires an explicit user decision. The local decision and stable Outbox command are committed atomically; source snapshots and AI output remain immutable.
- Review decisions are immutable first-pass records, unique per store/page/source block. Replay does not duplicate them. Another device's decision creates a domain conflict, preserving both local and remote choices/corrections. The review screen and synchronization conflict screen provide comparison and explicit adoption of the synchronized choice; the superseded local payload remains in the audit history. Editing an already submitted review decision requires a later revision workflow, not silent overwrite.
- No offer, operation, store plan, applicability, execution, sales/waste observation or official KPI is published by these controls. Missing dates/years/units and ambiguous mechanisms are not silently filled. A confirmed transcription can still need commercial validation before becoming an actionable offer.

Scope remaining within M5-T07: actual rendered PDF page previews (this increment displays **literal cited text**, not page pixels), grouped validation, canonical offer/product/applicability review and revision of an already submitted choice. These must not be treated as completed by the transcription buttons. No new native module was added; commercial-core is a shared JavaScript workspace dependency.

Verification: SQLite offline restart, atomic rollback, source/store/checksum identity, duplicate decisions, immutable snapshots, cursor rollback, pending-choice preservation, bootstrap adoption and explicit conflict resolution; isolated Atlas transactions cover concurrent page registration, legacy-client exclusion, another-device bootstrap restoration, replay, source tampering and conflict preservation. Lint/strict TypeScript, API build and iOS/Android bundle exports are required. No production drafts or decisions are written by these tests.

Physical iPhone acceptance after merge and loading this JavaScript version (Metro or updated EAS staging build):

1. Keep the existing PDF and synchronize once. In `Ma semaine`, verify `Analyse reçue` and `Examiner les extraits`; no reimport is needed.
2. Open the review, read/expand a citation, navigate between elements/pages, and verify uncertain source dates/operators remain visible without invented values.
3. Switch to airplane mode. Correct a unique field on one element, explicitly confirm its transcription, then dismiss another. Close/reopen: both choices remain with pending synchronization.
4. Reconnect and synchronize: the choices become synchronized once. Confirm that no commercial offer/operation or KPI was published by transcription review.
5. A conflict, if reproduced with two devices, must preserve both choices and corrections and offer explicit comparison/adoption of the synchronized decision.

M5-T07-A native acceptance remains pending. M5-T07 as a whole remains in progress.

## Pilot feedback — Review workload

The pilot opened the M5-T07-A build but rejected the 140-item mandatory-looking review flow as impractical. No complete native acceptance is claimed. The user confirmed that Dramat and prospectus are the primary reading priorities, the weekly document normally proposes four TG ideas, and threshold/degressive prices and lots are recurring weekly basics. A future signage-printing checklist was requested. The full conversational Copilot remains in M7; the current adjustment stays within M5.

## M5-T07-B — Source-based commercial brief and selective review

- `Ma semaine` opens a commercial brief rather than the first raw extraction item. Dramat/prospectus come first, followed by named source TG ideas and weekly basics. Source operation natures may overlap; they are not collapsed into one category. The catalogue retains all source offers, and secondary operations, deadlines and informational clauses remain consultable without mandatory individual acknowledgement.
- Classification uses only explicit operation names/natures, named TG captions and literal customer-mechanism wording. It does not infer product/operation relationships from neighbouring text. Dramat/prospectus sections can expose offers extracted on the same pages, explicitly labelled as a page association, not an established operation relationship. No missing TG is invented, no recommendation is truncated to force a count of four, and no source TG is declared selected for the store.
- Material source-field concerns, yearless dates, duplicate-price/period conflicts, page-wide warnings and sync conflicts are grouped by concern while retaining affected item/page references. A page warning is not repeated as an individual task on every block. Grouping is not a shared correction or resolution: relevant ambiguities remain to clarify before retaining the information in a canonical plan.
- Source details, original raw fields and existing human choices/corrections remain accessible. No source/cache/decision is deleted or silently replaced. The document brief is not an AI strategic recommendation and requires no new generation call; it uses the already anchored extraction and shared deterministic projection.
- Optional grouped acknowledgement is limited to at most 100 supported transcriptions per series. Low-confidence, null/unsupported fields, source issues, ambiguous date/operator/identity/applicability signals, conflicting offers and already recorded choices are excluded. Dates must have an explicit year and a valid supported simple calendar representation for grouped acknowledgement. This does not publish or validate commercial offers, product matches, dates of a store plan, applicability or execution.
- The repository rechecks the selected series against current SQLite snapshots/choices in an exclusive transaction. All decisions and ordinary `COMMERCIAL_TRANSCRIPTION_REVIEW` Outbox commands commit together or roll back together. Changed eligibility refuses the entire series; existing commands/choices are retained. Existing server idempotency/store/source checks and domain conflict policy are reused without a protocol change or migration.

A read-only projection of the retained eight-page pilot PDF found 58 source offer occurrences, four named TG ideas and nine grouped topics, rather than 140 mandatory-looking tasks. Before previously recorded choices are excluded, 68 transcriptions satisfy the conservative grouping policy. These are reading/transcription counts, not approved operations or a selected store plan. Raw grouping references and source price/date uncertainty remain intact.

The roadmap and M5-T07/M5-T11 implementation notes now record the scope boundary and the future signage-printing checklist. Actual PDF page rendering, canonical operation/product/applicability selection, submitted-choice revision and the weekly plan/checklist remain subsequent M5 work. The full cross-domain conversational assistant stays in M7, after M6.

Verification covers reading priorities, multiple natures, four source TGs versus unknown store capacity, no guessed operation association, no invented missing TG, grouped warning references, exclusion of unsupported/low-confidence/yearless/invalid-date/conflicting information, preserved sources and previous choices, atomic grouped decision/Outbox rollback, duplicate replay refusal and an intervening review. Physical iPhone acceptance remains pending after merge and loading this JavaScript version.

Native acceptance:

1. Open `Ma semaine → Voir la synthèse commerciale` using the retained PDF; no reimport is needed. The default screen must show the commercial brief, not a 140-step queue.
2. Consult Dramat/prospectus and their same-page offers, the four source TG ideas, and threshold/lot basics. Their source status and unconfirmed relationships must be clear.
3. Open a source detail, then return to the brief. Informational clauses do not require acknowledgement to keep reading.
4. Optionally confirm a readable series offline. Reopen and reconnect: each ordinary decision persists and synchronizes once; questions remain visible and no offer, TG, instruction execution or KPI is published by that acknowledgement.
5. Existing corrections/dispositions and conflicts remain visible, with source text separate from manually corrected values.

## M5-T07-C — Original PDF visual reading

The remote adapter now sends the immutable original PDF as a multimodal file, with text used as corroboration. It proposes nested operation dossiers instead of guessing relationships between neighbouring text blocks: Dramat/prospectus, products and price operators, specifications, deadlines, communication, source TG ideas and announced figures remain separately identifiable. The full conversational Copilot stays in M7.

Visual citations are proposals, never deterministic proof or automatic commercial validation. Literal corroboration is labelled separately; inconsistent field citations are removed from the anchored proposal, while private raw model output remains retained. Shared French-month dates can retain the month explicitly printed in their citation; a missing year is never invented. Existing text caches and human review decisions remain intact.

Inngest processes leased, retryable pages with checksum checks, immutable cache identities and transactional incremental sync. Mongo migration 16 and SQLite migration 17 add visual snapshots. The new capability is adopted through bootstrap; older clients skip unsupported changes. Saved readings remain available offline. Limits are 20 MiB and 16 PDF pages; failures remain visible with access to the original and older text extraction.

`Consulter le PDF original` uses the retained local copy on iOS through the system share/preview sheet. Otherwise an authenticated store-scoped endpoint returns a private, read-only link valid for 120 seconds. No Blob credential reaches the client. This is original-document access, not an embedded page renderer.

Two bounded read-only Gateway calls on the attached eight-page pilot PDF verified page 2: three distinct Dramat dossiers plus the banana campaign, including product attributes, source prices and strict price ceilings, explicit dates, the visual PLU 4274, and the difference between the banana poster's Costa Rica origin and the source's allowed origin alternatives. No production draft, choice, offer or KPI was changed by this diagnostic.

Verification covers literal/visual evidence, citation rejection, immutable native snapshots and cursor rollback, concurrent remote leases, checksum rejection without a model call, legacy-client filtering and store-scoped original links. Physical acceptance: synchronize the retained PDF, read the Dramat dossiers and their source conditions, open the original, then reopen saved readings offline. No reimport or data deletion is required.

## M5-T07-D — Focus on the actual current week

Pilot feedback requested a narrower reading after the visual extraction exposed future campaigns alongside current offers. The AI now receives the actual Europe/Paris date, ISO week number, ISO week-year and Monday–Sunday bounds. This reference is frozen at job registration and reused on retries, so crossing midnight/week boundaries does not change an in-flight extraction. Source dates remain source facts; the application context must never supply a missing source year.

New extraction focuses on actual current sales periods and source-cited weekly TG ideas. A shared deterministic filter enforces scope after anchoring and on existing local caches without regeneration, cache edits or loss of choices. Future S42/S43 campaigns do not become active because the document header says S41. Explicit sales ranges can overlap two weeks; missing, invalid or conflicting dates/years remain outside the focused offer list. ISO year boundaries and Paris daylight-saving transitions are covered.

The native view displays the current ISO week and French date bounds and refreshes its context on focus/foreground and minute ticks. Original sources and legacy details remain consultable. Only a short source-cited preorder/execution deadline inside this week may remain under a separate anticipation heading; future full offer dossiers/prices are not shown there. Unscoped TG ideas may use an explicitly dated single-week document header; that fallback never changes an offer's actual period.

A read-only projection of the existing eight-page pilot in S41/2026 yields 14 current dossiers instead of 23 and retains the four source TG ideas. It excludes S42 oignon and S43 orange Dramat from active offers. No additional model call or production rewrite was needed. This is the current-week default; the broader source archive and future multi-week calendar remain separate roadmap scope.

## M5-T07-E — Explicit store offer choices

A source offer can now be retained for the store after explicit product association, review of the sales dates and customer mechanism, store applicability confirmation and critical-field confirmation. This is a store choice **for planning**, not a published canonical offer/operation, a completed weekly plan, an execution or a KPI mutation. Only offers the manager chooses require this review; the document remains readable without acknowledging every extraction.

The native source brief exposes `Choisir cette offre pour mon magasin` and a compact `Mes offres retenues` section for the actual current week. The detail uses the local product catalogue, French date selectors, source quotes/original access and prefilled supported mechanics. Recognized prices stay compact with an explicit correction action; unresolved mechanics expose the five supported forms. Unknown product category/nature/unit do not require completing the Product Master; different price/product units trigger a nonblocking source-review warning; no conversion is inferred. Field errors identify the product, dates, mechanism or missing confirmations.

Choices can be modified, withdrawn and retained again offline. Source snapshots remain immutable. The choice, its local audit action and stable Outbox command commit together. A deterministic SHA-256-derived UUIDv8 identifies each store/visual-page/operation/item occurrence across devices. Separate commands retain their own immutable UUIDs. Commands for the same choice are sent sequentially; an old acknowledgement or background pull never replaces a newer pending local choice.

SQLite migration 18 creates `commercial_offer_choices` and `commercial_choice_history`. Mongo migration 17 creates store/source uniqueness, an active duplicate guard and versioned history. `COMMERCIAL_OFFER_CHOICE_UPSERT` rechecks tenant/source/product identity, explicit confirmations, typed dates/mechanics, typed source units and expected remote revision. Exact equivalent detail/recap terms with the same literal operation label within the same document cannot produce two active choices; withdrawal releases that guard. No arbitrary label fuzzy merge or source replacement is performed.

Capability-gated bootstrap/pull (`commercialChoices=true`) and one-time native adoption preserve older builds' cursors and restore earlier choices on another device. Push replay is idempotent. Different-device decisions preserve both payloads and expose product/date/mechanism/status comparison. Explicit local rebase or remote adoption preserves queued edits and the previous decision in audit history; no universal last-write-wins policy is added. Rejected choices retain local data and actionable error codes.

Acceptance on iPhone: open the retained PDF, choose a current offer, confirm the associated product, source dates/mechanic and applicability; retain it offline, close/reopen and observe it in `Mes offres retenues`; reconnect and synchronize once. Modify then withdraw offline, reopen and synchronize in order. A controlled two-device conflict must show both choices and allow an explicit resolution. The original PDF, prior extraction/transcription choices and official sales/waste/KPI data must remain unchanged. Physical acceptance is pending.

Remaining M5 scope includes corrected-PDF comparison, canonical operation/offer publication and store-plan validation, TG selection and the eventual execution checklist. This increment does not mark M5 complete or introduce the M7 chat. Additional anticipation tooling remains deferred as recorded in the roadmap.

## M5-T09-A / T10-A — Weekly preparation and TG assignments

The pilot accepted the retained-offer workflow on iPhone after PR #96. The next increment provides an explicit **DRAFT** preparation for the actual current store/week, not final weekly-plan validation or execution. The manager selects current retained offers, declares the TG capacity available this week, names placements and assigns selected offers. Source TG ideas remain optional inspirations with immutable source links; four PDF suggestions never imply four store locations. Empty themes/unassigned placements remain visibly incomplete draft work.

SQLite 19 stores `commercial_week_preparations` and its local action history. Mongo 18 stores `commercialWeekPreparations` and revision history. Shared Zod validation checks Monday–Sunday bounds, declared capacity, distinct locations and valid offer assignments. A source-derived stable UUIDv8 identifies a store/week preparation. Save, audit and Outbox commit together; revisions and explicit conflict resolution preserve earlier drafts.

Offer references pin the retained-choice revision. Changed/withdrawn/outside-week offers do not silently replace the saved preparation; the manager reviews an explicit update before resaving. Source inspirations are rechecked within the store. Remote processing waits retryably for an earlier offer revision still in the Outbox; stale/withdrawn offers are rejected with actionable feedback. No source, canonical operation/offer, execution, observation or KPI is published by this draft.

Capability-gated `commercialPreparation=true` bootstrap/pull and one adoption bootstrap protect older clients and restore drafts across devices. Same-preparation commands are sequential, older acknowledgements preserve newer local edits, and conflicts expose both drafts before explicit local rebase/remote adoption.

Physical acceptance: retain at least one current offer; open `Ma semaine → Préparer mon plan de semaine et mes TG`; select an offer, declare actual available TG capacity, add/name a placement and assign the offer. Optionally adopt a source idea as a theme, save offline, close/reopen and synchronize. Reduce capacity below planned placements and verify a precise refusal. Modify/withdraw a selected offer and verify the draft remains visible with a review/update requirement. Physical acceptance is pending. Final plan validation, corrected-PDF comparison, canonical publication and execution tracking remain subsequent M5 work; M7 chat and additional anticipation tools remain separate.

## M5-T08-A — Read-only comparison of corrected PDF readings

The pilot accepted the weekly TG draft on iPhone after PR #97. This increment adds an explicit old/new document selector and a source-reading comparison, without inferring a version relationship from filename/import date or activating a new source. Two PDFs with the same filename remain distinguishable by local registration time/checksum; originals can be opened before comparing.

The shared deterministic projection proposes matches from exact source identifiers or an exact literal productLabel field, within the source operation kind. AI descriptive titles are not used as proven product identity. Repeated identical source terms retain every citation; multiple terms variants or insufficient identity remain ambiguous. Price/mechanism (including strict/inclusive ceilings), sale dates, independent card base price, supplier/applicability conditions, deadlines and product attributes are compared. No fuzzy product validation, quantity/unit conversion or official KPI calculation is introduced.

Results are reading proposals, not definitive source edits. `Not found in the new reading` never means a source offer was deleted; partial/failed coverage, multiple model/schema caches and identical binary originals remain explicit. Existing retained choices and TG drafts referring to changed old occurrences are shown for review, including the manager's actual chosen terms, rather than replacing them with the new extraction. Source IDs/checksums/quotes and both originals remain accessible.

Comparison runs entirely from store-scoped SQLite snapshots and performs no mutation, Outbox command, migration, new generation or network dependency to render saved inputs. Existing source sync is reused. Tests assert boundary checks, unchanged source/choice/draft/Outbox rows, price/date/condition changes, ambiguity, independent card prices and cautious missing/new reading classification.

Physical acceptance requires two actual document versions with completed readings. Open `Ma semaine → Comparer un PDF corrigé`, explicitly choose old/new, inspect a material change and open both originals. Verify existing choices/TGs remain unchanged and identified for review. With a single PDF the comparison is unavailable by design. Source-version acknowledgement/activation and final plan validation remain subsequent M5 work; no VALIDATED/EXECUTED status is asserted by reading a comparison.

## M5-T08-B — Explicit source-reference decision after comparison

The comparator now records the manager’s reference preference for an explicitly selected pair of PDF originals: keep the previous PDF or prefer the corrected PDF for subsequent review. This is a **pair-scoped source preference**, not a globally active/validated source, an automatic offer replacement or final weekly-plan validation. Both complete immutable reading snapshots (UUIDs/checksums) remain pinned; identical binaries, incomplete coverage, altered tenant/source references and inverted comparison orientation cannot be submitted. Ambiguous offer identity remains unvalidated. No acknowledgement of every extraction block is required.

SQLite 20 adds `commercial_version_decisions` and its local audit table; Mongo 19 adds `commercialVersionDecisions` and revision history. Stable pair UUIDv8 IDs are orientation-independent; the captured old/new source identities stay immutable after the first decision. Save, history and `COMMERCIAL_VERSION_DECISION_UPSERT` Outbox commit atomically. The server rechecks all captured complete source pages and the expected remote revision. Preference changes are explicit revisions; old acknowledgements/background pulls preserve newer local edits. Conflicts compare local/remote preferences and permit explicit rebase/adoption while retaining superseded queued actions in audit.

Capability `commercialVersions=true` excludes the new entity from older installed clients while advancing their cursors. A capable upgrade performs one adoption bootstrap, restoring source decisions on another device. The native comparator offers the two choices after its differences, an optional note, explicit review confirmation and pending/synchronized/conflict/error feedback. `Ma semaine` lists saved comparison decisions with links to the preferred source reading and the exact comparison. Both PDF originals remain accessible. No offer, TG preparation, execution, sales/waste observation or KPI is changed by this decision.

Physical acceptance: with two actual PDF versions fully read, compare them, confirm source review and save a preference offline. Close/reopen; the choice must remain in the comparison and `Ma semaine`. Reconnect and synchronize once. Change the preference and synchronize again; offers/TG drafts must remain unchanged. If two devices disagree, resolve from Synchronisation after comparing the preferences. Physical acceptance is pending; the previous comparator build was delivered but its complete two-version iPhone acceptance has not been asserted. Global source-version activation, canonical offer/operation publication, final plan validation and execution checklist remain subsequent M5 work.

Verification: 444 local tests pass, including offline restart, rollback, ordered commands, old ACK/pull preservation, malformed-envelope rollback, capability adoption and explicit conflict resolution (including reversed orientation without changing the preferred original). Twenty-four isolated Atlas transaction tests pass across source decisions, preparations, offer choices, visual sync and two-device foundations. Lint/strict TypeScript, formatting, API compilation and iOS/Android bundle exports pass. Tests create/drop isolated databases only; no production business decision is created by diagnostics.

## M5-T07-F — Validation of selected commercial offer revisions and draft readiness

The pilot accepted the pair-scoped PDF reference preference on iPhone after PR #99. This increment adds explicit commercial validation for **selected offers in the saved weekly draft**. It does not require reviewing the entire PDF extraction catalogue. The draft shows the associated store product, exact chosen customer mechanism/dates, literal supplier/applicability/deadline mentions, citations and original access. A grouped human confirmation validates the selected current choice revisions; unsaved draft edits require saving first. Product category/nature/unit completion is not required, and no unit conversion is inferred.

`CommercialValidatedOffer` is an immutable, source-anchored snapshot of one retained choice revision and its normalized customer terms, with source fields/evidence, explicit source-reviewed confirmation and validation time. Stable store/choice/revision UUIDv8 IDs distinguish later choice revisions. Supplier conditions and deadlines remain literal source mentions; missing values stay null and this action neither normalizes purchase costs nor creates orders or deadline executions. Validation does not create a canonical operation grouping, a finalized weekly plan or an executed action. These remain subsequent M5 work.

SQLite 21 stores validation snapshots and local audit actions. The selected batch, its audit and Outbox commit in one local transaction. Mongo 20 stores `commercialValidatedOffers` with a unique store/choice/revision index. `COMMERCIAL_OFFER_VALIDATE` rechecks the exact remote choice snapshot, active store product and immutable cited source fields. Missing/lower choice revisions wait retryably for earlier Outbox dependencies; changed/withdrawn choices and forged source snapshots are refused precisely. Equivalent confirmations of the same immutable business snapshot converge to one record/change; a changed payload cannot overwrite that revision. Later modifications/withdrawal do not destroy historical validation and do not remain currently validated by their older snapshot.

Capability `commercialValidation=true` protects older installed clients and a one-time native adoption bootstrap restores previously skipped validations. Bootstrap/pull never replace a newer choice with its historic validation. Rejected local validations remain available for correction; an explicit retry preserves earlier action history. Superseded queued commercial actions remain auditable without being counted as active synchronization errors.

Shared readiness diagnostics identify outdated/missing/withdrawn/outside-week choices, current revisions awaiting validation, selected source references differing from the explicit PDF preference, empty TG placements, and competing fixed prices for the same product/unit on overlapping dates. Incompatible units and different ceilings are not automatically treated as competing fixed prices. The native view additionally checks the saved draft revision, active product/source availability and relevant sync errors/conflicts. Issues appear beside the affected offer or TG. These diagnostics never assert a `VALIDATED` plan status and do not compute an official KPI.

Physical acceptance: retain and select a small number of current offers, save the weekly draft, and open its new commercial-validation section. Read the selected products/dates/mechanisms/conditions and open the PDF source. Validate offline, close/reopen and observe the preserved pending state; reconnect and synchronize once. Modify one selected offer, verify its old validation remains historical and the draft requests review/update, then save the updated selection and validate its new revision. Try a conflicting fixed-price pair or an empty TG and verify targeted explanations. Official sales/waste/KPIs and existing TG assignments must remain unchanged. Physical acceptance is pending. Final plan validation, canonical operation grouping and the execution checklist remain next M5 increments.

Verification: 456 local tests pass. The six new isolated Atlas scenarios pass, alongside 24 passing existing transaction scenarios for reference decisions, preparations, choices, visual sync and two-device foundations. Coverage includes batch rollback, offline restart, immutable history after choice revisions/withdrawal, explicit retry/audit, unavailable products, tenant/source tampering, old-app exclusion, capable restoration and concurrent equivalent confirmations converging to one offer/change. Lint, strict TypeScript, formatting, API compilation and iOS/Android exports pass. New fixtures were corrected to use an Atlas-compatible temporary database name, real Outbox state transitions and Mongo date storage; no production data was involved.

## M5-T09-B / T10-B — Validated weekly plan and commercial operation grouping

The pilot accepted selected-offer validation on iPhone after PR #100. The weekly draft can now be finalized through an explicit confirmation of the proposed operations, selected validated offers and TG assignments. Only selected offer revisions participate; the entire PDF catalogue is not a validation queue. Grouping stays conservative: same source document, source kind, exact normalized operation label and chosen sales period. Different documents/kinds/periods remain separate. Literal recognized operation-nature fields can preserve several natures; neighbouring headings and ambiguous phrases do not establish relationships.

`CommercialWeekPlan` is a versioned **VALIDATED** store/week aggregate with a preserved draft snapshot, immutable offer-validation references, current PDF-preference references, product label/revision references, canonical planned operations and normalized offers. Stable UUIDv8 IDs identify the week plan, each confirmed revision and its canonical children. Exact chosen mechanisms/units/dates remain unchanged, including strict ceilings; announced source dates remain separate from planned dates, and actual execution dates stay null. Supplier purchase conditions remain unnormalized source mentions rather than invented official costs. Four source TG ideas never imply four available locations.

The local publication rechecks the current draft, current retained choice revisions, commercial validations, active products, cited source/TG links, relevant reference preferences and known synchronization conflicts. The server repeats these checks authoritatively. Missing earlier dependencies wait retryably; changed inputs are refused with review feedback. Canonical child arrays must equal the shared deterministic projection, preventing forged prices, extra offers or an invented execution state.

SQLite 22 adds current plans, local action history, confirmed plan revisions and derived `commercial_operations` / `offers` tables. Save, child materialization, audit and `COMMERCIAL_WEEK_PLAN_UPSERT` Outbox commit atomically. Mongo 21 adds the corresponding current-plan/revision indexes and canonical projections; current plan, children, immutable confirmed revision and incremental changes share the processed-command transaction. Child collections are **plan-derived projections**, not independently editable/syncable entities. Revalidation only replaces that plan's current projections; prior values remain in immutable revisions. Future execution must use separate execution records, not write actual events into these plan-derived caches.

Capability `commercialPlans=true` excludes both current-plan and immutable-revision envelopes from older builds while advancing their cursors. A native adoption bootstrap restores the current plan and its confirmed revision history. Pending newer plans/child projections survive old acknowledgements and pulls. Domain-specific conflict comparison shows the actual associated products, prices, periods and TG members. Explicit local rebase rechecks dependencies and regenerates the revision; remote adoption preserves the prior local action and retires superseded queued commands without counting them as active errors.

`Finaliser mon plan de semaine` appears after the saved draft and selected-offer validations. The manager can refresh its verification, inspect groups/source originals and explicitly confirm. `Mon plan de semaine` is an outside-tab detail view, reachable from Ma semaine; it reads SQLite and retains content during background synchronization. A source/product/preparation change produces a review requirement, not a silent replacement. Synchronized prior versions remain inspectable and never replace the current plan when opened. A new validation preserves the previous version and does not assert installation, signage printing, orders, actual prices, sales/waste observations or KPI changes.

Verification: 467 local tests and 35 isolated Atlas transaction scenarios pass. New coverage includes conservative grouping, plural literal natures, stable identifiers, rollback, offline restart, canonical relations, source/draft/product dependency drift, tampered price/execution rejection, idempotent replay, old acknowledgement preservation, confirmed-history restoration, old-app exclusion and explicit local/remote conflict resolution. The production Product Master stores identity in Mongo `_id`; the new loader/fixtures use that real shape. Lint, strict TypeScript, formatting and API/iOS/Android builds are required before delivery. Tests never publish a production plan.

Physical acceptance pending: save a current draft with selected commercially validated offers and nonempty planned TGs; inspect the proposed operations and source prices, explicitly validate offline, close/reopen and inspect the preserved pending plan. Reconnect/synchronize and verify one confirmed version. Modify/save the draft, revalidate and inspect both synchronized versions without losing prior prices/TG assignments. Changed/withdrawn offers, changed reference preferences and empty TGs must block finalization with precise feedback; source/choice/Product Master/official KPI data remain unchanged. The next M5 increment is the separate execution checklist; context providers/reminders and the full M7 chat are not delivered by this plan validation.

## M5-T11-A — Offline execution checklist for signage and TG installation

The pilot accepted weekly-plan validation/history on iPhone after PR #101. The plan detail now proposes separate tasks to prepare/print each selected offer's signage and install each planned TG. Proposed TODO items are recomputed from the saved validated plan; they create no event until the manager explicitly saves a declaration. Statuses are TODO, DONE, SKIPPED and NOT_APPLICABLE, with a free note and an explanation required for skipped/nonapplicable work. The form highlights missing explanations. Completion time is the time the manager **declares** the task done, not an invented physical start/end of a promotion.

Stable UUIDv8 task IDs bind store, immutable plan revision, canonical plan checksum, task kind and target UUID. The checksum prevents two conflicting local copies of the same numbered revision from sharing completion. New plan revisions have independent tasks: old DONE declarations remain inspectable with their original plan and are never silently carried to changed prices or TG assignments. Counts retain partial completion and skipped/nonapplicable states; they do not assert the whole operation was executed, a cashier price was applied, an order placed or a sales outcome achieved.

SQLite 23 stores current declarations and local action history. State/note changes, audit and COMMERCIAL_EXECUTION_TASK_UPSERT Outbox commit atomically. Mongo 22 persists current tasks and revision history with tenant/target indexes. The server rechecks task identity, label/target and the immutable confirmed plan copy; absent earlier plan revisions wait retryably. A mismatched confirmed plan copy is refused with precise feedback while local actual-work declarations remain preserved. Local capture can use a known confirmed or locally validated/audited plan snapshot, including an older version, so field work is not blocked by AI availability or later source changes.

Capability commercialExecution=true and one-time bootstrap adoption protect older apps and restore current/historical-plan task states across devices. Commands for one task are ordered; stale ACK/pull never overwrites a newer pending correction. Contradictory device statuses/notes create an explicit conflict. Local rebase or synchronized adoption preserves prior local actions and superseded queued commands. Notes being edited are not replaced by background task refresh. An editor stays attached to its selected plan copy; declarations for another local copy are retained separately rather than counted against the current copy's tasks.

No source document, offer validation, plan/canonical projection, product, sales/waste observation or official KPI is changed by these bounded task declarations. Actual prices, quantities, supplier actions, whole-operation start/end and causal attribution are outside this checklist increment. Source originals and the chosen pricing framework remain visible in the plan; ceilings are not converted into actual signage prices.

Physical acceptance pending: open a validated plan and its new execution section. Mark one signage task DONE offline, close/reopen and verify the status/note remain; reconnect/synchronize once. Mark a TG SKIPPED/NOT_APPLICABLE with a reason, then correct a DONE task back to TODO and verify the latest correction persists. Validate a new plan version and verify its tasks start TODO while the prior version retains the earlier facts. A controlled two-device conflict must show both statuses/notes and require explicit resolution. No plan price, observation or KPI should change from marking a task done.

Verification: 478 local tests and 40 isolated Atlas transaction scenarios pass, including field restart/rollback, declared partial progress, independent plan revisions, known local-copy capture, ordered corrections, old ACK/pull preservation, source/tenant/target guards, plan dependency retry, explicit task conflict reconciliation and old-app exclusion/restoration. Lint, strict TypeScript and formatting pass. API compilation and iOS/Android bundle exports pass; the task editor uses a native modal with an unsaved-change close confirmation and no new native dependency. Tests create/drop isolated databases only and never declare production work done.
