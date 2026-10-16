# Copilot manual-operation coverage inventory

Updated 11 October 2026. This inventory maps the current repository/service surface before chat activation. It is a wiring backlog, not a claim that all CRUD is available. `product.inspect`, `analytics.daily`, `waste.inspect`, `commercial.offers`, `store.events`, `substitution.lookup`, `store.week`, `source.reference` and `need.list` are executable internally; the model-facing envelope accepts no store, actor, role, SQL or credentials.

An internal WRITE registry now also includes `product.classify` for bounded category/nature/sales-unit corrections. It requires trusted user-intent authority and canonical local product/Outbox writes; native/model exposure remains pending. The additional catalogue WRITE registry now provides `product.save` (bounded full editor create/update and identifiers/aliases) and `product.retire` (canonical logical deletion). The need WRITE registry now provides `need.save`, `need.membership` and `substitution.save` for reviewed need maintenance and validate/reject decisions, with preserved learned fields and explicit refusal reversal. Dedicated alias/identifier validation/recovery/conflict tools, unconfirmed proposal producers and batch orchestration remain explicit follow-ups; this is not blanket CRUD coverage.

The field WRITE registry adds `store.event.capture`/`store.event.close`, using a distinct trusted capture capability and canonical USER observations; it does not grant catalogue permissions or mutate stock quantities.

## Authority and execution contract

- Reads use the authenticated store and private conversation owner, existing local repositories, and typed source snapshots with observed time and sync quality. Ordinary reads need no extra confirmation.
- Routine create/update tools require an explicit user intent bound to the proposed fields and current entity version. Trusted adapters resolve store, actor, device and command IDs; model arguments cannot grant authority. Canonical validation, prior human refusal and domain conflicts apply.
- Publication, corrected overlaps, critical ambiguous identity and retirement require the existing targeted preview/decision. Acceptance and execution stay distinct. No universal last-write-wins or physical DELETE is introduced.
- Each activated tool has its own strict versioned input/result schemas, trusted adapter and retry identity. Planned entries below cannot be invoked until those adapters and acceptance tests ship. One generic unvalidated JSON mutation tool is prohibited.
- Read results are device-local operation snapshots in SQLite migration 35. The same operation ID/input replays that snapshot after restart; use a new operation ID for fresh data. Revoked access or a foreign conversation blocks cached replay. Failed/cancelled reads do not persist a success. They do not create business Outbox commands.
- Write operation results must join the canonical local mutation/Outbox transaction in T20/T21; this read journal is not a remote writer or proof that mutations are exactly-once. Device result replication/context references and AI SDK binding are pending orchestration work.

## Existing public repository/service operations

Every listed method/function maps to the indicated tool family. `apply*`, persistence helpers and processing plumbing are internal synchronization/derived operations, never direct model tools. Existing public operations are inventoried even where not currently exposed as a button. Retention/history remain immutable according to their domain.

### products.product-editor-service

Adapter source: [`product-editor-service.ts`](../../apps/mobile/src/products/product-editor-service.ts). Target: **T20**.

Operations: `now`, `generateId`, `loadProductEditorSnapshot`, `saveProductEditor`, `productSnapshotToDraft`.

### products.product-master-repository

Adapter source: [`product-master-repository.ts`](../../apps/mobile/src/products/product-master-repository.ts). Target: **T20**. `getProduct`/`listIdentifiers`/`listAliases` are reused by active `product.inspect`.

Operations: `upsertProduct`, `upsertIdentifier`, `upsertAlias`, `rememberWasteReceiptAlias`, `retryWasteAliasDeletion`, `delete`, `getProduct`, `listProducts`, `getIdentifier`, `getAlias`, `listIdentifiers`, `listIdentifiersByStore`, `listAliases`, `listAliasesByStore`.

### documents.commercial-pdf-capture

Adapter source: [`commercial-pdf-capture.ts`](../../apps/mobile/src/documents/commercial-pdf-capture.ts). Target: **T23**.

Operations: `persist`, `remove`, `assertPdfHeader`, `captureCommercialPdf`.

### documents.import-verification-conflict-repository

Adapter source: [`import-verification-conflict-repository.ts`](../../apps/mobile/src/documents/import-verification-conflict-repository.ts). Target: **T23**.

Operations: `listOpen`, `getBySourceDocumentId`, `keepLocalTemporarily`.

### documents.mercalys-import-publication

Adapter source: [`mercalys-import-publication.ts`](../../apps/mobile/src/documents/mercalys-import-publication.ts). Target: **T23**.

Operations: `findExactDuplicate`, `analyzeOverlap`, `keepExisting`, `publish`.

### documents.source-document-repository

Adapter source: [`source-document-repository.ts`](../../apps/mobile/src/documents/source-document-repository.ts). Target: **T23**.

Operations: `createWithFile`, `createCommercialPdf`, `ensureCommercialPdfUploads`, `commercialPdfUploadJob`, `retryCommercialPdfUpload`, `listDocuments`, `addRecords`, `getDocument`, `getFileForDocument`, `listRecords`, `findDocumentByChecksum`.

### documents.waste-publication-validation

Adapter source: [`waste-publication-validation.ts`](../../apps/mobile/src/documents/waste-publication-validation.ts). Target: **T23**.

Operations: `validateWastePublication`, `wastePublicationWarnings`.

### documents.waste-receipt-capture

Adapter source: [`waste-receipt-capture.ts`](../../apps/mobile/src/documents/waste-receipt-capture.ts). Target: **T23**.

Operations: `persist`, `persistWasteReceiptCapture`, `persistWasteReceiptImport`, `resolveWasteReceiptImageExtension`.

### documents.waste-receipt-publication

Adapter source: [`waste-receipt-publication.ts`](../../apps/mobile/src/documents/waste-receipt-publication.ts). Target: **T23**.

Operations: `inspect`, `validate`, `publish`, `applyWastePublication`.

### documents.waste-receipt-repository

Adapter source: [`waste-receipt-repository.ts`](../../apps/mobile/src/documents/waste-receipt-repository.ts). Target: **T23**.

Operations: `createCapturedDraft`, `createDraft`, `getReceipt`, `listReceipts`, `listLines`, `getReceiptDetail`, `retryProcessing`, `resolveExactDuplicate`, `applyRemoteDuplicate`, `applyRemoteDraft`, `confirmCashierNumber`, `confirmWasteDate`, `updateLineValues`, `setLineExcluded`, `selectProductCandidate`, `insertSourceDocument`, `insertReceipt`, `insertLine`.

### commercial.comparison-repository

Adapter source: [`comparison-repository.ts`](../../apps/mobile/src/commercial/comparison-repository.ts). Target: **T21**.

Operations: `readCommercialComparison`.

### commercial.execution-repository

Adapter source: [`execution-repository.ts`](../../apps/mobile/src/commercial/execution-repository.ts). Target: **T21**.

Operations: `get`, `list`, `save`, `resolve`, `applyCommercialExecution`, `readCommercialExecutionPlan`.

### commercial.offer-choice-repository

Adapter source: [`offer-choice-repository.ts`](../../apps/mobile/src/commercial/offer-choice-repository.ts). Target: **T21**.

Operations: `list`, `get`, `save`, `resolve`, `applyCommercialChoice`, `readCommercialChoices`.

### commercial.review-repository

Adapter source: [`review-repository.ts`](../../apps/mobile/src/commercial/review-repository.ts). Target: **T21**.

Operations: `pages`, `decisions`, `review`, `reviewReadableGroup`, `useRemoteDecision`, `applyCommercialReviewEntity`, `reviewProgress`.

### commercial.substitute-repository

Adapter source: [`substitute-repository.ts`](../../apps/mobile/src/commercial/substitute-repository.ts). Target: **T21**.

Operations: `read`.

### commercial.validated-offer-repository

Adapter source: [`validated-offer-repository.ts`](../../apps/mobile/src/commercial/validated-offer-repository.ts). Target: **T21**.

Operations: `validate`, `readValidatedOffers`, `applyValidatedOffer`.

### commercial.version-decision-repository

Adapter source: [`version-decision-repository.ts`](../../apps/mobile/src/commercial/version-decision-repository.ts). Target: **T21**.

Operations: `get`, `save`, `resolve`, `applyCommercialVersionDecision`.

### commercial.visual-repository

Adapter source: [`visual-repository.ts`](../../apps/mobile/src/commercial/visual-repository.ts). Target: **T21**.

Operations: `applyCommercialVisualReading`, `readCommercialVisualReadings`.

### commercial.week-plan-repository

Adapter source: [`week-plan-repository.ts`](../../apps/mobile/src/commercial/week-plan-repository.ts). Target: **T21**.

Operations: `get`, `save`, `resolve`, `applyCommercialPlan`, `applyCommercialPlanRevision`, `readCommercialPlanRevisions`.

### commercial.week-preparation-repository

Adapter source: [`week-preparation-repository.ts`](../../apps/mobile/src/commercial/week-preparation-repository.ts). Target: **T21**.

Operations: `get`, `save`, `resolve`, `applyCommercialPreparation`.

### needs.evidence-repository

Adapter source: [`evidence-repository.ts`](../../apps/mobile/src/needs/evidence-repository.ts). Target: **T20/T21**.

Operations: `list`, `get`, `states`, `applySubstitutionEvidence`, `applySubstitutionEvidenceState`.

### needs.lookup-repository

Adapter source: [`lookup-repository.ts`](../../apps/mobile/src/needs/lookup-repository.ts). Target: **T20/T21**.

Operations: `read`, `readSubstituteSnapshot`, `substituteReadOnlyReader`. The exported snapshot reader remains an internal read adapter for the lookup tool.

### needs.membership-repository

Adapter source: [`membership-repository.ts`](../../apps/mobile/src/needs/membership-repository.ts). Target: **T20/T21**.

Operations: `list`, `get`, `save`, `saveBatch`, `resolve`, `applyNeedMembership`.

### needs.repository

Adapter source: [`repository.ts`](../../apps/mobile/src/needs/repository.ts). Target: **T20/T21**.

Operations: `list`, `get`, `save`, `resolve`, `applyNeedUnit`.

### needs.score-repository

Adapter source: [`score-repository.ts`](../../apps/mobile/src/needs/score-repository.ts). Target: **T20/T21**.

Operations: `list`, `applySubstitutionScoreHistory`.

### needs.store-event-repository

Adapter source: [`store-event-repository.ts`](../../apps/mobile/src/needs/store-event-repository.ts). Target: **T20/T21**.

Operations: `list`, `get`, `create`, `close`, `retry`, `resolve`, `applyStoreProductEvent`.

### needs.substitution-repository

Adapter source: [`substitution-repository.ts`](../../apps/mobile/src/needs/substitution-repository.ts). Target: **T20/T21**.

Operations: `list`, `forSource`, `get`, `save`, `saveBatch`, `resolve`, `applyProductSubstitution`.

### store.context-repository

Adapter source: [`context-repository.ts`](../../apps/mobile/src/store/context-repository.ts). Target: **T19/T21**.

Operations: `get`, `save`, `resolve`, `applyStoreContext`.

### store.weekly-context-repository

Adapter source: [`weekly-context-repository.ts`](../../apps/mobile/src/store/weekly-context-repository.ts). Target: **T19/T21**.

Operations: `get`, `save`, `contextIsStale`.

### reminders.repository

Adapter source: [`repository.ts`](../../apps/mobile/src/reminders/repository.ts). Target: **T21**.

Operations: `snapshotChanged`, `preferences`, `setEnabled`, `list`, `save`, `setStatus`, `subscribeReminders`, `subscribeReminderSnapshots`.

### analytics.local-recomputation

Adapter source: [`local-recomputation.ts`](../../apps/mobile/src/analytics/local-recomputation.ts). Target: **T19**.

Operations: `recomputeProduct`, `recomputeDepartment`, `process`, `enqueueAnalyticsRecomputationJob`.

### copilot.conversation-repository

Adapter source: [`conversation-repository.ts`](../../apps/mobile/src/copilot/conversation-repository.ts). Target: **T17/T19**.

Operations: `scoped`, `list`, `save`, `resolve`, `append`, `messages`, `saveDraft`, `draft`, `applyCopilotRecord`.

### copilot.priority-repository

Adapter source: [`priority-repository.ts`](../../apps/mobile/src/copilot/priority-repository.ts). Target: **T17/T19**.

Operations: `evaluate`, `read`.

## Screen journeys and planned tool families

- `products`, product editor: catalogue/detail, create/update, identifiers and aliases, retirement and conflict/retry → product catalogue tools (T20). Product selection in receipt/import uses the same master, not a second catalogue.
- `imports`, import-verification: source capture, matching/create missing product, confirm/reject associations, inspect quality, duplicate/overlap reconciliation, keep existing/publish corrected valid lines → Mercalys intake/reconciliation tools (T23) plus catalogue (T20).
- `waste`, waste-capture/import, waste-receipt: one/multiple photos of one ticket, source/processing retry, duplicate resolution, cashier/date confirmation, line quantity/unit/amount/price edits, exclude/restore line, select/create product, inspect/publish → receipt intake/validation/publication tools (T23/T20).
- `week`, commercial-review/offer/operation/comparison: original opening, source review/readable-group decision, offer validation, compare versions, retain/reject/apply version → commercial review tools (T19/T21/T23).
- `week-preparation`, commercial-plan: offer choices, preparation, four TG/plan fields, versioned plan revisions → planning tools (T21); commercial execution save/status/note/history stays a separate tool family.
- `need-units`, need-unit, need-memberships, product-substitution, substitutes, substitution-evidence/score: list/detail, create/update/retire need, validate/reject memberships and directed relations, batch save, lookups and evidence/score/history → need/substitution tools (T19/T20/T21). Deterministic scores/evidence are reads; the model cannot overwrite them.
- `store-events`, store-event: observed stockout/availability, create and explicitly close event, retry/conflict → field-event tools (T21). Unknown stock remains unknown.
- `store-settings`, reminder-settings: read/save store context; weather/calendar retrieval; enable/disable reminders, save/status/snapshot → store-context/reminder tools (T19/T21). Permission requests and OS notification settings remain device UX.
- `Aujourd’hui`, `Analyses`, priority detail: typed KPI/coverage/period reads, candidate eligibility/score/conflicts and evidence → analytical/priority tools (T19). No handwritten model arithmetic.
- Sync/conflict screens: domain-specific compare/use remote/keep local/retry → scoped entity resolution adapters (T20/T21/T23). Login/logout, manual sync, diagnostic XLSX and Sentry test are application infrastructure, not business tools for the model.

## Explicit remaining activation gates

T19 remaining: flexible quantitative periods beyond daily/J−7, product/category analysis, evidence/detail, public-web authenticated/persistent/native orchestration and original-source UI binding. The bounded OpenAI research adapter is implemented but deliberately not exposed as a paid route or advertised model tool; source.reference now resolves an opaque commercial-original action for the existing opener. Daily/J−7 reads, receipt inspection, paginated retained-offer/event reads, directed substitution lookup and cached weekly context now use the existing local services. T20/T21 remaining: dedicated catalogue identity validation/recovery/conflict tools, proposal/batch orchestration, event recovery/conflict and commercial adapters, native intent/review binding and valid reversals. The bounded classification adapter already binds exact user intent to atomic canonical writes/Outbox and local operation-result identity. T22: inline missing-information forms. T23: local attachment/intake orchestration and Resend verified reception. T24/T25: memory/compaction. Generation/native UI are later delivery blocks. This inventory does not approve omissions from V1; unmapped new manual operations must update it before chat acceptance.

## M7-T21b — internal weekly preparation tools (11 October 2026)

`commercial.preparation.inspect` reads the explicit Monday's local draft and sync state through the existing repository; absent data stays absent. `commercial.preparation.save` accepts a reviewed full draft plus its expected local version (null for creation). App code supplies store, deterministic week identity, command ID, clock and a distinct `canPrepareCommercialWeek` capability. It preserves creation time and advances the canonical revision.

The canonical preparation schema/repository enforce week boundaries, capacity, placements, offer versions/status/period and visual-source references. Changed offers and invalid TG sources return targeted French errors. Conflict/error drafts require dedicated recovery. Request/result identity, canonical history and Outbox save join one SQLite transaction; exact replay is checked only after current conversation/owner/permission authority. No publication, execution, calculated stock, paid AI call or native chat activation is added. Retain/withdraw choices, plan execution, recovery and native review binding remain separate T21 work.

Real SQLite tests cover offline save/read, exact replay after restart, revisions, reviewed permission, invalid capacity, changed choices, cancellation and failed commit rollback. No EAS build is required for these internal adapters.

## M7-T21c — internal commercial choice tools (11 October 2026)

`commercial.choice.inspect` reads an owned choice by ID, including withdrawals, with revision/sync state; missing data remains absent. `commercial.choice.save` records a reviewed, bounded full choice (create/update/withdraw), using the existing CommercialChoiceRepository. Store, deterministic source identity, clock and command ID are app supplied; `canManageCommercialChoices` is independent of catalogue permissions. A retained choice requires the associated active product's exact version, confirmed applicability/critical fields and the original reading's operation/item labels. Canonical mechanism validation and duplicate prevention remain in force.

Withdrawals require an existing exact-version choice and preserve its product, period and mechanism. Source/creation identity and all history remain canonical; withdrawal does not update a saved preparation or execute a plan. Conflicted/error records require separate recovery. Reviewed request authority, local mutation, history, Outbox and cached operation result join one SQLite transaction. Revoked/foreign authority cannot replay results. The adapter is internal: native chat/review binding, paid generation and dedicated recovery remain pending. No EAS build is required.

## M7-T21d — reviewed commercial plan tools (11 October 2026)

`commercial.plan.preview` reads an explicit week's preparation and canonical context, returning readiness issues or a deterministic candidate from `buildCommercialWeekPlan`. Its embedded VALIDATED-shaped candidate is provisional: the READ operation writes only its private result journal, never a business plan/Outbox. The app injects the digest function; it cannot be supplied by model input.

`commercial.plan.validate` accepts only the persisted preview operation ID. Trusted `canValidateCommercialPlan` authority must bind the exact request to a reviewed USER message in the same owner/store/conversation, dated at or after the preview. It rechecks the current plan revision, readiness and exact deterministic rebuild of the preview. Product/choice/preparation/reference changes require a fresh review. IDs, scope, version, clock and plan content come from canonical app services, never a model-authored plan. The final validation timestamp is the actual application time.

The existing CommercialPlanRepository atomically saves the plan, materialized operations/offers, canonical history and Outbox together with the tool result. Local history records the pending revision; remote revision snapshots arrive through normal synchronization. Exact replay after restart does not duplicate writes. No execution in rayon, AI generation, native chat activation or paid EAS build is introduced. Dedicated offer-validation tools, execution and conflict recovery remain follow-ups.

## M7-T21e — reviewed offer validation tool (11 October 2026)

`commercial.offer.validate` internally validates 1–25 exact retained choice revisions through the existing ValidatedOfferRepository. Model arguments contain only choice IDs, choice versions and expected product versions. App scope supplies a dedicated `canValidateCommercialOffers` permission, the exact reviewed USER request, device/command IDs and clock, plus trusted review attestations for every selected choice/version/reading/checksum. Model-supplied review booleans cannot grant authority. Native source-review UI binding remains pending; these internal attestations are not yet produced by a live chat.

The adapter checks active owned products, current versions and sync state; canonical source extraction preserves the original fields and evidence in immutable validation records. ERROR/CONFLICT require separate recovery. The complete batch, canonical history, Outbox and tool result share one SQLite transaction. A later unchanged request returns existing validation entities with null command IDs; exact operation replay retains its original result after restart, with permission/conversation and source-attestation checks still required. No plan or field execution is implicitly saved.

Real SQLite tests cover batch success/restart, unchanged no-op, stale versions, missing or mismatched source review, foreign/revoked authority, second-source failure, failed commit, cancellation and failed-record preservation. No paid AI call or EAS build is required. This completes the internal choice → offer validation → preparation → plan adapters; generation/native orchestration, execution and conflict/recovery tools remain pending.

## M7-T21f — internal commercial execution tools (11 October 2026)

`commercial.execution.inspect` returns the current explicit week's canonical signage/TG checklist, matching declarations, sync state and deterministic progress. Missing plans stay absent and tasks without declarations remain TODO. A DONE count is a user declaration, never automatic evidence of field execution; conflict/error states remain visible.

`commercial.execution.save` records a reviewed status/note for one current-plan target, with exact plan/task versions (null task version for creation). App code derives the target label, identity, revision/checksum and timestamps from the canonical checklist; model input cannot forge these or grant `canDeclareCommercialExecution`. DONE sets the application declaration time, a note-only edit preserves it, and explicit reopening clears it. Ignored/non-applicable tasks require a reason. Identical status/note is a no-op. Old plan targets cannot silently transfer to a new revision; historical-plan editing and dedicated conflict recovery remain follow-ups.

The existing CommercialExecutionRepository writes canonical history and Outbox in the same transaction as the private tool result. Exact replay survives restart without duplication and current authority is rechecked. Plans, offers, stock and analytics are not mutated; the tool does not print an actual sign. Tests cover checklist reads, declarations/restart/no-op, version chaining, date semantics, changed plans, authority, missing plans, conflicts, cancellation and failed-commit rollback. Native chat integration remains pending. No paid EAS build or AI call is required.

## M7-T21g — internal store settings tools (11 October 2026)

`store.settings.inspect` reads the owned store's canonical settings/version/sync state; missing configuration stays absent. `store.settings.save` accepts reviewed city/postal code/school-zone values and an explicit location policy (`CITY` or `KEEP`), with an expected local revision. Trusted `canManageStoreSettings` is distinct from catalogue/field permissions. IDs, country/timezone, versions and timestamps come from app code; model input cannot inject coordinates or claim a new DEVICE capture.

KEEP preserves a recorded point exactly; creation without prior settings uses CITY. An address change while keeping a DEVICE point requires explicit CITY selection or manual device recapture. CITY clears the old point through canonical settings save. Unchanged settings are a no-op. Conflicted/error settings require dedicated recovery. Canonical history/Outbox and the private operation result join one transaction; current authority is checked before exact replay after restart.

No GPS permission, OS setting, external geocoding/weather request or AI call is performed. A changed settings fingerprint excludes the previous weather/calendar cache from fresh `store.week` reads without deleting its history; provider refresh remains a separate operation. SQLite tests cover absence/read/save/restart/no-op, point preservation/explicit city selection, coordinate forgery rejection, revision chaining, cache isolation, stale versions, rights, conflicts, cancellation and commit rollback. Native chat/source/form binding remains pending and no EAS build is required.

## M7-T22a — contextual question schemas and local response drafts (11 October 2026)

Typed question definitions contain 1–8 unique contextual fields, a short explanation, reliable prefill candidates and parent USER/operation IDs. Supported fields are DATE, decimal NUMBER with explicit unit, bounded TEXT, enumerated CHOICE and opaque FILE source references. ISO calendar dates and available choices are checked; decimal strings accept a French comma and normalize without floating-point arithmetic. Partial/invalid values remain raw editable drafts and return field-keyed issues. Numbers with units and dimensions are facts to collect, not calculated business results.

SQLite migration 36 adds owner/store/conversation-scoped `copilot_forms`. The local repository checks an active owned conversation and parent USER before creation, preserves exact definition retry identity, and version-checks edits. Answer edits merge by field; null/empty clears a value. SAVE evaluates OPEN/READY, POSTPONE preserves answers and CANCEL terminates the question. A changed trusted app basis token marks the old question STALE while preserving its earlier answers. Tokens must be derived/rechecked by native orchestration, never accepted from model authority. Unknown or missing/deleted/foreign FILE references cannot become ready; attachment intake remains T23.

These are internal local drafts: READY does not publish observations, authorize a tool or prove verified financial data. No business Outbox/server record is generated; cross-device question replication, canonical answer consumption, actual chat resumption and inline rendering remain follow-ups. This increment does not claim the full T22 gate. SQLite tests exercise partial reply/restart, precise decimals, field errors, postpone/resume/cancel, obsolete questions, rights/version isolation, saved attachment scope, failed commit/cancellation and upgrade from schema 35 preserving pending sync/history. No EAS build or paid AI call is required.

## M7-T22b — submit a contextual response into private conversation history (11 October 2026)

The internal form submission service consumes only an exact READY form revision, with a trusted explicit submit confirmation bound to its ID/version and current app basis token. It rechecks owner/store/active conversation, readiness and live saved-source scope. It creates a canonical immutable USER reply linked to the original request, retaining exact normalized values (decimal strings, ISO dates, choice IDs and opaque source references) in the form's submission receipt. Human-readable text displays field labels, French dates and units; repeated source references produce a single attachment entry.

Message/history Outbox and ANSWERED receipt join the existing SQLite transaction. Exact retry after restart returns the same message/receipt, and a submitted form cannot be edited into a different answer. Existing migration-36 form payloads default to no receipt; no new migration or API business entity is required. Current permission/confirmation and basis are rechecked before replay. Wrong revisions, incomplete/obsolete answers or a deleted/foreign file return scoped errors and field issues without sending a message.

The canonical conversation append path adds an optional app-only `preserveDraft` flag: inline-form submission preserves an unrelated composer draft, while ordinary append retains its existing clearing behavior. This is conversation synchronization only; no product, observation, plan or financial figure is published. Source processing, automatic agent resumption and actual inline chat UI remain follow-ups, so T22's full gate is still pending. Tests use real SQLite for restart/replay, composer preservation, exact values, source revalidation/deduplication, stale/foreign authority, commit rollback, cancellation and old-payload compatibility. No paid AI or EAS build is needed.

## M7-T22c — reusable native inline question card (11 October 2026)

`CopilotInlineFormCard` renders the short explanation and only the declared fields, using existing design tokens/buttons and DateSelector. Decimal inputs carry units, choices are accessible radio options, field-keyed issues are announced and highlighted. The user can send, postpone or cancel. POSTPONED is collapsed with a resume action; ANSWERED/CANCELLED/STALE render a short state rather than repeating the whole form. The controlled host supplies drafts, pending/error state and authorized file intake; no source picker is guessed or added through a new native dependency.

The paired controller invokes the canonical form draft/submission services, evaluates the current basis before save and again before sending, and returns incomplete fields without creating a message. If sending fails after draft save, its typed error carries a freshly scoped persisted form so the host can keep the correct revision for retry. Real SQLite tests cover missing-field edits, submit, postpone/resume, cancelled send/retry and a context change between save/send.

Visual verification used the actual component in a temporary isolated Expo web harness at 390×844 with synthetic data: field errors, French decimal entry, the existing calendar, radio selection, postpone/resume preserving entries and collapsed confirmation. The harness/root layout and temporary theme workaround were removed/restored afterward; no test route/menu is shipped. Native exports and normal project checks validate the production tree. The browser fixture tests rendering only; SQLite service tests cover persistence separately. This is not full native-chat acceptance, and automatic generation/resumption/file intake remain pending. No EAS build or paid AI call was used.

![Native inline card — synthetic local verification](../progress/assets/m7-inline-form.jpg)

### Classification proposal preparation

`product_classification_preview` is now an authorized server read/preparation tool for one exact owned product: category, nature and sales-unit before/after, current synchronized version, changed fields and fields requiring review. It uses the same shared comparison as `product.classify`, never writes or produces trusted user authority, and cannot replace local version/conflict checks. Native persisted proposal cards and exact user-intent confirmation remain pending; the internal WRITE adapter is not directly callable by the model.

The first native intent/review binding now supports typed persisted `product.classify` proposal TOOL cards for one product each. Explicit MANAGER confirmation uses the current SQLite profile and canonical mutation runtime, with version/conflict refusal and journal-based local replay. Model output, received tool messages and preview generation remain preparation only. Batch/partial editing, persistent dismissal, broader catalogue writes and cross-device operation-journal restoration remain separate gates.

`product_classification_batch_preview` now prepares up to ten explicit product patches as a complete owned selection, with per-item availability and version checks. The native grouped card confirms the whole prepared lot atomically through `product.classify`, with named stale members and no partial writes. Batch preview is not automatic product identity validation, catalogue-wide classification or publication authority.

`request_information` now prepares one bounded missing-information form (DATE/NUMBER/TEXT/CHOICE), with no model-supplied authority or prefills. A private compatible TOOL artifact drives the existing native form persistence/validation widgets. Explicit submission adds a USER declaration and one pending reply/Outbox atomically, preserving the composer. The server links a later answer to its exact owned original question, flags supersession/omitted text and keeps declarations separate from official facts and write authority. File/photo form intake and cross-device synchronization of incomplete private form drafts remain pending.

### Native conversation intake bridge (M7-T23)

The chat attachment menu now hosts conversation-bound Mercalys XLSX/ZIP manifests and reuses the existing native import review/publication screen. Retained lots can be reopened from their private conversation. An explicit post-publication action prepares a coverage-aware analysis question in the existing draft, preserving text and PDF references; the manager still sends that question. This is native intake UI, not a model-granted publication capability or a synchronized archive/manifest entity. Native grouped ready-line publication now previews and confirms through the same canonical writer; automatic missing-file-request resumption remains pending.

## M7-T25 continuity — private conversation context reads

`conversation_history` reads earlier USER/ASSISTANT entries only in the current authenticated active topic. Bounded timestamp/UUID pages, literal passage search, shared correction exclusion and whole-message budgets preserve original text and IDs. Attachment metadata is revalidated by existing source ownership rules; content reading remains the corresponding PDF/receipt tool. The model cannot supply tenant/topic scope. Conversation prose is not official KPI evidence, a confirmed business action or memory-write authority. Original local/display history is unchanged. Versioned semantic compaction remains separate work.

## M7-T25 extractive private context checkpoints

`compact_context` prepares a bounded selection of whole original paragraphs when recent history is incomplete. It retains source message identities and labels assistant text as proposals. The server verifies private scope, exact paragraph, role, time, supersession and source/parent fingerprints; immutable private TOOL snapshots commit with the reply and normal replication changes. No store memory or business action is confirmed by this tool. Existing source references carry forward under an explicit bound and are revalidated before reading content. `conversation_history.messageId` recovers exact original text under the same scope/time rules. Identical notes/files are a no-op; stale context is not reused. A native read-only expansion inspects the historical selection, with original paginated history preserved. This is the extractive path; full semantic-summary and end-to-end device quality remain acceptance work.

### Public research activation — 16 October 2026

T19 now connects the existing bounded public-research adapter to the authenticated Copilot loop for clients advertising native web-source support. `public_research` accepts only a screened public topic/purpose; the server selects private conversation scope and canonical USER-message identity. Mongo migration 37 journals one majority-reserved paid request per question, with exact completed replay and no automatic rerun of uncertain/failed calls. The adapter receives no appended store history, figures, memory or source files. Query screening is defense in depth, not a claim of complete DLP.

External findings retain their own provenance/access time and safe source links through the existing evidence and native source-sheet path, separate from official observed KPIs. Ordinary business writes remain unavailable to the research adapter. Older clients do not advertise this tool; native link opening and live research quality require the next grouped acceptance build. No paid build or live search is part of this implementation validation. See M7-T19d in `../progress/M7_COPILOT.md` for limits and test evidence.
