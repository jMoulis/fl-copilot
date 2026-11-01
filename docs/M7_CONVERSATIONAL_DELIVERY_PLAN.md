## Current owner arbitration — 1 November 2026

Mercalys intake is Actions-only (earlier chat-import reference journeys below are superseded). The pense-bête supports weekly merchandising strategy: evaluate enseigne themed TGs, Dramat/prospectus/permanent/degressive lots, discuss presentations and optional counter-promotions using available store figures and expertise, then explicitly save the agreed plan. No extraction/transcription-validation workflow before advice. The reusable minimum store context is active TGs/positions, department implantation and declared habitual circulation, separate from measured 2D feasibility. See the owner arbitration in `specs/COMMERCIAL_PLANNING_AND_PROMOTION_ENGINE_FUNCTIONAL_SPEC.md` and the first-increment [QA/remaining gates](qa/M7_COMMERCIAL_STRATEGY_ENTRY_2026_11_01.md). The full V1 and seven workstreams remain unchanged.

# M7 — Primary conversational Copilot delivery plan

**Approved product direction:** 11 October 2026. **Language:** French in the application; English specifications. **Owner:** Julien. This plan updates the original M7 scope without changing React Native/Expo, SQLite local-first, Fastify/Vercel, MongoDB, private Blob or the shared deterministic engines.

## Product contract

The chat is the principal workspace and centre of the application. The manager sends documents/photos, asks questions and discusses strategy. The Copilot retrieves facts, prepares work, asks targeted missing-information questions and invokes authorized business tools. Existing screens remain useful details/corrections, not a compulsory sequence of configuration forms. M5/M6 are tools within this assistant, as are the other manual business functions.

V1 must cover quantitative daily/product/period analysis; sales/margin/waste evolution and plausible explanations; ruptures, shopper needs, associations/substitutes; rich commercial PDFs, photos and weekly strategy; product units/nature and other supported CRUD; tasks, decisions and execution; multiple conversations, shared authorized knowledge and compaction; constrained implantation scenarios and illustrations. Official calculations remain deterministic. The assistant can explore an idea without a pre-existing alert, while separating hypothetical discussion from grounded operational recommendations. Three main priorities limits the action brief, not the conversation length.

**Reference journey:** “What should I prepare this week?” → identify missing Mercalys days → ask for the appropriate export in an attachment/form card → persist and process it → show any material ambiguity/corrected-overlap decision → publish trusted observations through existing services under the user's intent → refresh calculations → resume the discussion → propose a plan and tasks → user decides → execution is recorded separately.

## Delivery sequence — eleven blocks

### 1. Agree the native conversation UX (T16)

Before production chat UI, review a native prototype with Julien. One clear composer, easy files/photos, concise replies, topic history, inline forms/action cards and progressively revealed sources/details. Keep the current five-tab constraint until navigation is explicitly agreed; determine how the chat is the default entry in that review. Include keyboard, one-handed use, accessibility, streaming/interruption and understandable offline/retry states.

[Prototype 1](prototypes/copilot-chat/README.md) was approved by Julien (“Oui nickel”) on 11 October 2026. Its natural dialogue, targeted forms and five-tab direction are accepted; actual native functional/device acceptance remains pending.

**Gate:** owner approves five journeys: file-to-discussion, missing-data form, product batch correction, source/detail opening and restart/retry. Do not equate functional tests with UX acceptance.

### 2. Persist conversations and establish tool authority (T17–T18)

Store conversations, messages, drafts, attachments and operation/result references locally with stable IDs; provide authorized durable restoration through the existing sync architecture. Define deletion/archive/recovery and append/edit conflict behaviour explicitly. Paginate history and preserve drafts/source files offline. Keep personal conversation content separate from shared store knowledge.

Inventory every existing manual business operation. Give each tool a versioned schema, authorized store/actor, validator, confirmation rule, idempotency identity, read/write classification and French progress/result/error contract. The model selects intentions; trusted services resolve scope/IDs and enforce permissions. Never accept model-generated SQL, database commands, credentials or actor authority.

**Gate:** history/draft survive restart and one tool retry runs exactly once; the coverage inventory lists every manual operation and any explicit proposed deferral.

### 3. Read facts and apply store expertise (T19, T26)

Expose shared analytics for available periods/products/categories, quality/coverage, sales/margin/waste, operations, ruptures, substitutions/evidence, commercial plans, weather/calendar and action history. Include an authorized public-web search/read tool for relevant retail, shopper, produce, merchandising, market and calendar questions; retain external provenance and freshness separately from store facts. Open original documents through authorized source services; source intake/vision and official numeric calculation remain distinct. Use the existing original-PDF understanding rather than reducing the commercial brief to a few isolated labels.

Add a curated/versioned produce-retail/shopper reference: purchase needs, complementarities, substitution, offer visibility, merchandising and seasonality. The assistant identifies contributors and competing explanations, asks for discriminating facts and proposes checks. Correlation is not established causality, aggregate article/day data is not individual shopper tracking, and missing stock/cost/history stays unknown. Flexible quantitative period requests need explicit data coverage and the shared calculation service, not handwritten model arithmetic; agree supported presets/references during implementation.

**Gate:** explain a CA/margin evolution and a rich Dramat/prospectus with cited facts and missing-data qualifiers; open the originals. Answer a relevant web-research question with usable source links/date context and no contamination of official store KPIs.

### 4. Make current manual business actions accessible (T20–T21)

Product/catalogue tools cover supported create/read/update/retire operations, units/nature, identifiers/aliases, needs/memberships and directed substitutions. Field/commercial tools cover observations/closure, choices/drafts/plans, TG assignments, tasks, decisions/executions and supported store settings. Use current actor rules, entity versions, canonical validation, atomic local transaction/history/Outbox and domain-specific conflict handling. No parallel business implementation or arbitrary remote-only writer.

Use batched proposed corrections so the manager does not type every unit/nature. Explain the basis and changed fields; preserve prior human confirmations/refusals and distinguish an inference from a validated fact. A clear user request may authorize routine validated changes without repeated modals; critical ambiguity, materially consequential/corrected publication and destructive changes require a targeted preview/decision. All actions remain traceable, and reversal is explicit where the domain supports it. “All CRUD” applies to supported business records, never rewriting immutable original documents, derived audits or historical facts in place.

**Gate:** perform representative manual tasks from the chat; retry without duplicates, preserve a human refusal, show a meaningful conflict and support a valid reversal/retirement.

### 5. Ask for missing facts naturally (T22)

Translate unavailable/ambiguous data into a small contextual question. Render typed inline forms for dates, numbers with units, product/option choices, dimensions, notes and files/photos. Explain why the information matters and prefill reliable existing facts. Ask only the fields relevant to this decision, accept partial answers, allow cancel/postpone, keep offline drafts and resume after answers or a new file. Do not request the whole catalogue or every supporting row when a useful answer is already possible.

Examples: “The last two business days are missing; add your daily Mercalys export”; “What is the purchase cost for this promotion scenario?”; “What are this TG's usable width and depth?” The form/file response is bound to the question, scope and operation; changes invalidate obsolete follow-ups.

**Gate:** a missing-number answer and an attachment answer both unblock their original question without losing the conversation or asking the same fact again.

### 6. Orchestrate sources from chat and Resend reception (T23)

For user/device attachment intake, persist immutable local originals and per-file processing state first. External email reception is durable server-side intake: retain source files/state remotely, process asynchronously, then replicate authorized results to device SQLite; primary app reads and user actions remain local-first. Route Mercalys, commercial PDFs, waste photos and rayon photos through their proper existing/approved adapters; never classify a rayon photo as a waste receipt by guessing. Parse/normalize/match/reconcile/publish using current engines and actor rules. Receiving a file does not silently validate ambiguous identities or overwrite a corrected overlapping import.

Support a request containing several authorized sources with item-level progress, retry and bounded concurrency; one failure does not roll back completed items. Independent ticket batches and several photos of one long ticket need explicit grouping semantics. Raw intake/drafts, trusted published observations and remote AI processing remain separate states. Once required data is saved/published, recompute through shared engines and resume the pending analysis automatically. Explain blocking ambiguity with a targeted card rather than an opaque error.

**Required bulk intake:** select multiple Mercalys sales/CA or waste workbooks, or a ZIP containing supported workbooks. Preserve each source/channel/business period and archive parent/child lineage; a ZIP is not a combined business observation. Support independent waste-photo ticket batches and explicit multi-photo grouping for one long ticket. Apply the detailed bulk-intake acceptance and archive limits in [the product roadmap](PRODUCT_ROADMAP.md#bulk-source-ingestion--m7-t23-requirement). Persist a paginated batch manifest and per-item outcomes; never silently truncate to the chat attachment cap, flatten source channels or manufacture daily observations from weekly/monthly aggregates. Duplicate/reconciliation/publication decisions remain those of the existing services.

**Gate:** chat request → Mercalys saved locally → validated publication → unchanged official lineage/parity → discussion resumes; exact duplicate/corrected file/restart/offline/failed-item scenarios are handled.

### 7. Share knowledge and compact context (T24–T25)

Allow named topic conversations (weekly planning, margin/waste, implantation) that share authorized store facts and curated memory. Memory separates canonical data, confirmed preferences/constraints/decisions, source-derived claims and hypotheses. Record provenance, date, scope, status and version; provide correction/forgetting and invalidation. Raw private messages are not silently published to another user or store. Establish which memory is user-private versus store-shared before adding multi-user sharing.

Manage context budgets and versioned compaction. Preserve user objectives, confirmed constraints, decisions, unresolved questions, tool/result/source IDs and attachment references. Retrieve exact current figures from tools instead of trusting a conversational summary. Keep paginated original history accessible and mark stale summaries. Never silently change financial precision, product IDs, periods or validation authority during compaction.

**Gate:** two chats reuse a confirmed store constraint while remaining context-isolated; correct/forget memory; compact a long discussion and recover exact sources, decisions and open questions after restart.

### 8. Deliver French generation and the primary chat (T06–T09)

T01–T05 are already implemented. Complete the structured French synthesis, hard grounding checks and deterministic outage fallback; wire the approved primary native conversation to the tool/history/form/source pipeline. Recommendations preserve facts, interpretation, options, risk, confidence, missing information and a measurement plan. Detail is progressive, not a dense compulsory form. Respect eligible candidates, canonical scores and trade-offs, while supporting contextual exploration and targeted clarification.

Choose/configure the generation model and budget at activation, reusing the existing authorized server key. Distinguish generation success from factual grounding. Reject unsupported figures/IDs/dates/fourth priorities; expose useful fallback when AI is unavailable. No secret or raw provider error enters the conversation/logs.

**Gate:** complete approved conversation journeys on the pilot iPhone with grounded sources and useful outage behaviour. Group EAS testing into a substantial acceptance build, not every ticket.

### 9. Decide, execute and review (T10–T13, T15)

Support accept/modify/postpone/refuse through chat cards, preserve decision intent offline and stale/context-conflict handling, and record execution as a separate explicit action. Review before/during/after through existing analytical services and qualify confounders. Do not auto-execute an accepted recommendation or overwrite a decision after model regeneration.

**Gate:** offline decision → restart → synchronized changed-context reconciliation → explicit execution → source-grounded review; all actor/action history is inspectable.

### 10. Simulate commercial and implantation scenarios (T14, T27–T28)

Commercial scenarios use deterministic numbers and explicit assumptions; known purchase cost and required facts gate margin-based figures. Break-even is not a sales forecast.

For implantation, the store-owned physical reference comes first. Use [Store plan and furniture specification](specs/STORE_LAYOUT_SPEC.md), agreed with Julien on 19 October. The store page owns the interactive 2D plan, furniture dimensions/positions, optional under-furniture selling mobiles and version history; conversations reuse it. The pilot has two islands, each assembling eight fixed single-face elements (four per face), plus three TG elements. Each island element has an aluminium bac and its own upper shelf. Mobiles exist under only some fixed elements, display sale products and usually retain their habitual position. Do not create them by default or duplicate an upper shelf across faces.

Adapt the existing fleg reference as unconfirmed starting data to the native local-first architecture. A consultation plan and element front view distinguish bac, upper shelf and mobiles; geometry editing is deliberate and versioned. Known data is reused, missing measurements stay unknown and measurements can be collected progressively. Normal commercial proposals assign products to existing surfaces without moving furniture; physical rearrangement is a separate explicit request. Physical reference, weekly allocation, illustrative image and execution stay distinct.

After canonical storage/sync and geometry-aware controls, produce a schematic and generated illustrative image anchored to the same physical revision and commercial scenario. Retain original/photo provenance and flag relevant changes. Projected overlap of a mobile beneath a fixture is not automatically a physical collision; unknown clearance is not proof of fit. The PR 264 flat preflight must be adapted to this hierarchy and pilot inventory. Image activation and paid acceptance remain separately controlled.

**Gate:** store-owned plan → offline/restart/sync-safe reference/draft → targeted measurement confirmation → source-bound commercial proposal → canonical schematic → linked illustration → accepted pilot case. Impossible placement and unknown fit are identified, and reference changes create a new version rather than silently replacing previous assumptions.

### 11. Accept the complete V1 Copilot (T29, golden suite, M7 exit)

Run file → trusted figures → explanation → missing-data form → correction/plan → decision → execution → review, plus multi-chat memory/compaction and constrained implantation. Include complete offline/restart/reconnect, tenant isolation, idempotency/conflict, source/grounding failure, cancelled tool call, model outage and critical human-validation scenarios. All current manual business operations have tool coverage or an explicit owner-approved exception. UX acceptance is separate from numeric/infrastructure checks.

Then run M8 security, accessibility, recovery, performance, backup and release acceptance; M7 completion alone is not a production pilot certificate.

## Scope/count and next action

Original M7-T01–T05 are completed. Ten original implementation tickets T06–T15 remain, plus the original golden/exit acceptance. Fourteen additional work packages T16–T29 describe the approved chat/tool/memory/forms/source/expertise/visual scope. M8 retains its fourteen tickets. This is a planning inventory, not 38 compulsory PRs or a duration estimate; regroup delivery around the eleven blocks and split risky changes appropriately.

The prototype direction is approved and T17 private history is deployed. T18 establishes the tool authority/read-retry foundation and [manual coverage inventory](specs/COPILOT_TOOL_COVERAGE.md); next, activate contextual reads (T19) and canonical mutation adapters (T20/T21) before native chat integration. In parallel implementation phases, use already built business services; do not redesign the architecture or repeat completed deterministic M7 work. Voice and unrelated external browsing/integrations are optional extensions to prioritize explicitly; direct ordering, external price/Storeline/Mercalys changes and unattended business execution remain outside this V1.

## Required manual-function coverage inventory

Before T18 is accepted, map each current screen/repository action to a tool and its domain policy. Include existing read, create/update, publish/reconcile, close/retire, validate/reject, revert/cancel and history operations. Do not invent a physical DELETE where the domain only supports retirement or immutable history. Track inventory gaps as explicit tasks; “all CRUD” must not be claimed from a few representative tools alone. Existing operational authority/conflict policies and source privacy apply to chat as well as manual screens.

## Natural interaction and web research — confirmed 11 October 2026

The conversation must feel natural: understand ordinary wording, follow topic changes, retain pending goals, answer concisely and deepen on request. Do not force every exchange into a form, recommendation card or three-priority format. Start with an ordinary question; offer a small inline form when structured dates, amounts/units, choices, dimensions or files make the answer easier. Prefill confirmed facts, accept partial responses and ask only what is materially needed. Do not repeat known facts or ask permission for every ordinary read/search; respect explicit business authority and critical-change gates.

Public-web research is required V1 tool coverage within T19, not an optional afterthought. The assistant may search/read relevant sources when the question benefits from external or current information, then synthesize and link them naturally. Prefer primary sources for factual/technical claims; show publication/event/access dates where freshness matters, reconcile conflicting sources and state unresolved uncertainty. External offers/prices must retain applicable location, dates and conditions; they are not measured store sales/cost/stock. Search results cannot replace the deterministic application engines or become confirmed store observations silently.

Web pages, documents and results are untrusted source data, never tool authority or instructions to disclose secrets/change rules/write business records. Keep store/user scope, query purpose, source URLs and timestamps traceable; minimize private store data sent in searches and never send credentials or private-source URLs. Retrieved facts and any durable web-derived memory retain provenance, expiry/revalidation and uncertainty. No external site login/action, order or price change is authorized by a search request. Research failure yields an explicit limit and useful available-context answer, not invented results. Agree search-provider, latency/cost bounds and source-opening UX during T19 implementation.

UX acceptance adds a free-text business question, a targeted optional form and a source-backed web answer. The user can open the cited page and continue the conversation without losing context.

## Resend development inbox — approved 11 October 2026

Julien approves Resend inbound email as a V1 source-intake channel, initially using the account's development receiving address. Resolve the actual Resend-managed receiving subdomain at configuration; a reserved alias such as `imports@<account-id>.resend.app` is illustrative until then. Do not use `onboarding@resend.dev` as the inbox: it is the existing test-sending identity. No custom receiving domain, MX change or direct Gmail API/Google Cloud integration is required for the first iteration. Directly send/forward files to the reserved inbox; an optional targeted Gmail forwarding filter can follow without redirecting the whole mailbox.

T23 includes: verified POST `email.received` webhook → durable intake/deduplication → permitted authenticated sender/recipient-to-store policy → attachment retrieval and immutable private storage → existing Mercalys/PDF/receipt classifiers and processing services → authorized persistence/sync → a conversational receipt/progress/result or targeted clarification. Resend attachment metadata is not file content; retrieve the actual bytes through its receiving API and preserve them independently of temporary download URLs. Refresh an expired URL through the provider API rather than losing the source. Keep received message/attachment IDs, store scope and checksums for lineage/idempotency, including retries and duplicate file arrivals through chat/email.

Receiving authorization is explicit configuration, not inferred from an email body/display name. Verify webhook signatures and sender authentication/allowlist policy, bind only reserved recipients to trusted store IDs, verify MIME/size/type and existing-key receiving permissions, and keep email/private links out of public logs/model instructions. Incoming content cannot create actor privileges or override human validation/refusals. The first policy automates source retention/extraction/preparation; any automatic publication of business observations requires explicitly configured trusted-source authority and deterministic safe conditions. Ambiguous identities, corrected overlap or materially consequential changes remain targeted decisions. Do not route authentication/forwarding-verification messages to business AI processing.

Email intake can run while the phone is offline. Preserve remote source/job state, then deliver authorized local results through the existing replication flow and show the receipt in the appropriate store conversation. Processing failure must be retryable without duplicates; successful files must survive another attachment's failure. No emails, forwarding rules, domain/MX, webhook, keys or paid AI calls are configured by this planning commit.

**Acceptance:** one authorized email with Mercalys + PDF → correct store and original retention → existing parsing/extraction → chat receipt/result → device receives state after reconnect. Test exact retry, duplicate chat/email file, malformed/unapproved sender, invalid signature, expired download URL, partial attachment failure and corrected-source review. Public-source references for implementation: [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction), [attachment retrieval](https://resend.com/docs/dashboard/receiving/attachments) and [Gmail targeted forwarding](https://support.google.com/mail/answer/10957).

### Block 9 increment — descriptive task review (18 October 2026)

A current saved signage/TG task can now be connected to its exact recorded declaration and a product's deterministic before/during/optional-after comparisons plus bounded recorded events through the chat. Periods are explicit and missing data remains unknown. Citations preserve the dated review snapshot in private history; no declared physical action or causal effect is manufactured. Code is ready for grouped delivery and real dialogue acceptance. The full block-9 gate remains open, including durable original recommendation/decision linkage and the complete offline decision/restart/reconciliation/execution/review journey.

### Block 9 increment — explicit advice choices (18 October 2026)

The primary chat can now prepare a private source-bound decision card from a specific prior assistant suggestion. The manager records Accept/Modify/Postpone/Reject locally with ordered history and Outbox; repeated presentations of the same original advice keep one workflow. The model can inspect synchronized latest choices without treating them as completed actions. Actor/source/version checks, offline retention, conflict comparison and explicit resolution use the existing local-first/private synchronization architecture. This is conversational advice with unvalidated current context, not an automatic eligibility upgrade of model prose. Current-fact staleness, durable decision→execution linkage and the full real acceptance gate remain open. Delivery stays grouped, API before compatible native client; no paid build is triggered.
