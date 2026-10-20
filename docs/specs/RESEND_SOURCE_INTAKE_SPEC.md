# Resend source intake — V1/L8

This implements the later user-approved M7-T23 commitment. The v0.1 ingestion document's historical exclusion of email ingestion does not remove this V1 requirement. Preserve Fastify, private Blob originals, Mongo durability, SQLite/Outbox and existing classification/import/reconciliation/publication services. No second agent or alternative business-number engine is introduced.

## Product path

The owner obtains a development receiving address from the existing Resend-managed account subdomain; `onboarding@resend.dev` is an outbound test sender, not this receiving address. An authenticated application setup binds an opaque recipient to a current store, owner and owned conversation, with an explicitly allowed sender. Subject, body, filenames and model arguments never select or override that binding. Revoke/replace the binding explicitly; do not repurpose it for another store or owner.

Received documents appear in the bound conversation with per-file durable status. Preserve original ZIP/file/photo/PDF bytes and order before processing. Reuse the existing batch and document pipelines; show genuine ambiguity questions in the chat. Successful clean imports retain the same automation and deterministic publication rules as chat intake. Exact duplicates across mail/chat must not double-publish, while corrected overlaps still require normal reconciliation. Separate independent waste photos from an explicitly confirmed multi-view ticket.

## Trust and authorization

A verified Resend signature proves delivery of a provider event, not that the declared `From` address is an authenticated user or that an email body may issue commands. An exact sender allowlist and opaque recipient are routing filters. They must never replace current application membership/permission checks or grant the model new authority.

Initial V1 admission uses an authenticated in-chat confirmation for the received batch before any business import/publication or paid analysis. Keep this inline, without sending the user to a separate manual import flow. This is distinct from subsequent product/line ambiguity review: once admitted, clean documents use the ordinary automation. Do not claim authenticated sender-based unattended publication from a parsed email header. A later unattended policy requires independently verified sender authentication and an explicit, revocable scoped grant.

HTML, quoted/forwarded instructions, attachment text and filenames remain untrusted source material. Never execute commands, visit arbitrary body links, change product data, create durable shared memory or send external replies from email prose. No new AI prompt layer is needed: admitted attachments enter the established document/tool channels with source provenance. Do not fetch remote images in email HTML. Rejected senders are acknowledged without disclosing the binding and without downloading bodies/files.

## Server path and persistence

1. Encapsulated Fastify POST webhook receives a bounded raw body. Verify signature with the installed Resend SDK and current configured signing secret before interpreting metadata. Keep exact original bytes; JSON parse/reserialize is not signature verification. Reject missing/multiple signature headers, stale/future signatures, malformed metadata and duplicate attachment IDs. Acknowledge other valid event types without processing them.
2. Resolve exactly one active opaque recipient, declared sender and current scoped membership/conversation. Never copy a single event into multiple stores. Recheck authorization at each external I/O boundary and before committing effects.
3. Durably record provider email ID and attachment IDs with stable application UUIDs, bounded metadata, raw-payload hash and provenance. Unique provider-event/email/attachment keys make replays idempotent; a reused identity with contradictory metadata is quarantined. Record minimal rejection reasons without logging message bodies, credentials or temporary URLs.
4. Acknowledge only after durable admission/ignore recording. A transient database/queue failure must remain retriable. Reuse the existing durable execution infrastructure with scoped leases, bounded concurrency/retries and explicit status; do not add a new polling service.
5. Fetch the exact received email and attachment metadata through the provider SDK only when required. Compare returned email/attachment IDs and immutable metadata with the recorded envelope. Refresh short attachment URLs as necessary. Bound file count, individual/aggregate size, byte reads, expansion and file types; disable redirects/credentials to attachment hosts, reject local/private-network targets and never consume URLs from email prose.
6. Persist private originals with SHA-256/size/type proof before marking them ready. Retain good files when another attachment fails or storage/processing is interrupted. No signed URL is durable. Preserve all existing canonical source IDs and publication/reconciliation history.
7. Authenticated native reads cache the private intake state in SQLite; an explicit confirmation and its Outbox command are atomic. Close/reopen/offline/account switching must preserve pending work and prevent stale owners from admitting another account's files. After confirmed intake, existing source jobs/import handlers own processing; no simulated published/analysed state is created merely to display email metadata.

## Required evidence and activation gates

- Raw-signature tests through the actual installed SDK, including tampering, reserialization, old/future signatures and bounded payloads.
- Real Mongo replay/dedup, contradictory-event quarantine, recipient/sender isolation, revoked membership and deleted/changed conversation tests; no user/store binding from subject/body.
- Provider adapter identity/size/URL/expiry/redirect/network guards and partial-file retention; providers/Blob simulated until approved live acceptance.
- SQLite + Outbox admission, restart/offline, actor-switch and two-device reconciliation, with exact-once business results for chat/mail duplicates and corrected overlaps.
- User-visible PDF, Mercalys sales/waste XLSX/ZIP and independent/grouped photo receipt paths. Acknowledge unavailable/unsupported attachments individually. Native list/chat context stays intact.
- Real managed receiving address, full receiving-capable account credential and signing secret must be provisioned through authorized secure configuration. Do not read/write `.env` or print secrets. Register/enable the webhook only after a compatible endpoint is deployed and tested; retain revocation and rollback.
- No sending, domain/DNS change, provider spending, live AI test or EAS build is implied by local development.

## Initial signature checkpoint — 20 October

The read-only connector inspection found no configured webhooks, no beta inbox objects and zero received messages. This does not prove that the account's managed receiving subdomain is absent. The dashboard requires sign-in; its actual receiving address has been requested from the owner. No account configuration was changed and no email was sent. The installed `resend` SDK is 6.30.0; its actual verification arguments are `webhookSecret` and headers `id`, `timestamp`, `signature`.

`apps/api/src/intake/resend-event.ts` implements the bounded raw-signature/metadata/routing gate. `resend-webhook.ts` supplies the encapsulated Fastify POST handler and awaits an injected durable admission before acknowledgement. Twenty-six tests exercise actual SDK signatures, native Fastify injection, ordinary JSON parser isolation and retriable admission failure. At that initial checkpoint these modules were not wired into `buildApp`, durable Mongo admission, native UI or a provider webhook. The later envelope and preservation checkpoints below record the subsequent local implementation; provider activation and native delivery remain unproven.

Official references checked for implementation:

- [Receiving emails and the managed subdomain](https://resend.com/docs/dashboard/receiving/introduction)
- [Retrieve received email](https://resend.com/docs/api-reference/emails/retrieve-received-email)
- [Get email content](https://resend.com/docs/dashboard/receiving/get-email-content)

## Durable envelope checkpoint

The branch now includes Mongo migration 45, atomic envelope/event receipt, immutable bindings, explicit revocation, owner-scoped pagination and authenticated API routes with typed client methods. Real Mongo tests cover concurrent replay, metadata quarantine, revoked/archived/foreign scopes and transaction rollback through the actual raw Fastify webhook. The application registers the inbound route only with explicit complete receiving configuration; ordinary API behavior remains unchanged. No live webhook/configuration has been provisioned.

This checkpoint does not fetch or retain attachment bytes, dispatch processing, expose a native intake card or commit an admission Outbox action. Those are the next parts of the same delivery lot, not optional follow-ups. Preserve originals asynchronously as soon as an authorized delivery is queued; business processing/AI still waits for authenticated admission. Do not leave already received originals dependent on a long-lived provider download capability.

For the attachment adapter, the current official endpoint returns a short URL on `inbound-cdn.resend.com` with email/attachment identity in its path. Restrict capabilities to the documented provider host and exact expected identities, enforce expiry/bounds, disable redirects and never take a URL from the email body. The original-fetch path can use the attachment SDK endpoint directly, without fetching or rendering email HTML. These are implementation requirements, not a claim that the worker is already built.

- [Retrieve received attachment](https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment)


## Private-original execution checkpoint

The unreleased migration 45 now creates per-file preservation jobs in the same transaction as the envelope and provider ledger. After durable admission, the signed webhook dispatches these stable job identities through the existing Inngest client; queue failures return 503, and a provider replay dispatches the same identities without duplicating the receipt/jobs. The existing recovery function retries due jobs; no new polling service or cron frequency is added. Production receiving configuration requires the execution keys as well.

Each worker claims a scoped, expiring lease, verifies current membership/conversation/binding and receipt state around provider/Blob I/O, and retains one original in private immutable Blob storage. Paths contain application identities/checksum, never an email filename. The exact-byte SHA-256/size/declared-MIME reservation is persisted before upload, so a later invocation can recover a completed upload after a lost acknowledgement without a new provider URL. Metadata/proof/paths remain server-private. Good files survive another file's failure, cancelled authorization or a crashed invocation. Lost leases cannot commit another worker's result. Exhausted crashed jobs resolve explicitly rather than remaining pending forever.

Preservation bounds: 50 attachments from the signed envelope, 50 MiB per file, 100 MiB reserved original bytes per email, atomic aggregate reservations, two concurrent worker executions, six download attempts with backoff and a bounded lease. A final crashed attempt may recover an already stored proof but cannot initiate a seventh provider download. These are original-retention bounds; the existing format/ZIP-expansion/business-validation rules still govern admission to the canonical pipelines.

No original-preservation result creates a canonical source/import/publication, changes the receipt to business COMPLETE or invokes AI. The batch remains AWAITING_CONFIRMATION. Native cache/configuration/admission/Outbox, original access and canonical pipeline integration still belong to this same unfinished delivery lot. These local tests simulate provider, Blob and dispatch ports; no real email download, upload, paid analysis or receiving-provider configuration was performed.


## Scoped original access checkpoint

The same unreleased branch now exposes authenticated manifest/download routes for one ready email file, bound to the current store/owner/conversation/receipt/file and the worker's immutable reservation. The manifest deliberately has no canonical source type: a ZIP or declared MIME remains unclassified source material. Its canonical serialization and SHA-256 bind all public file identities/metadata. Internal Blob keys, worker leases, provider capabilities and proof records are not public fields.

The server reconstructs the expected key from trusted identities and checksum, compares the actual Blob pathname/size/type, and rechecks the live receipt, conversation and membership after I/O and signing. A download capability lasts two minutes and is never a durable intake target. Private responses use no-store. Quarantined/dismissed or not-yet-ready records cannot issue capabilities. The API client validates the scoped request and private Blob URL response; native cache and content-hash verification must bind those results again before use.

These are server/client-contract capabilities, not yet a native original viewer, batch-admission action or canonical import. The next delivery work remains SQLite/cache, explicit admission with atomic Outbox and private incremental sync/conflict handling, then the existing business pipelines. Preserve the ordinary source-original service and its stricter canonical source-type rules; do not mislabel an email attachment to reuse that service.

## Native read/cache and durable recovery checkpoint — 20 October

Local migration 52 adds owner/store/conversation-scoped email binding/receipt caches and verified raw-original manifests. The private server page is merged transactionally, never treated as a business admission: preserve older pages, monotone versions/revocation and immutable provider/file identities. Reject contradictory equal-version snapshots, foreign scope, archived conversations and role/account changes. Cached subjects and filenames are inert text. The list renders from SQLite; a failed refresh does not clear existing entries.

The native file adapter computes paths exclusively from validated identities and checksum, verifies exact byte count/SHA-256 and retains unclassified bytes. It reuses the extracted bounded private-file transport used by canonical source originals. Canonical type/header/photo-view validation remains with the canonical adapter. A MIME declaration is not promoted to a business source type. Temporary capabilities are never persisted, incomplete transfers remove only their own partial copy, and confirmed originals remain immutable.

Email recovery shares the existing `SourceOriginalJobs` queue and SyncProvider lifecycle, with a separate scoped job identity. There is no new polling service or business parser. The same durable claim/retry/cancel mechanism handles restart, departed-owner interruption, stale leases and immutable proofs. Claims and acknowledgements check the exact attempt, not only its timestamp. Private pending-work counters filter by owner. Transfer authorization, manifest identity/hash, receipt state and current conversation are checked around I/O and again in the cache transaction; remote access is rechecked after download before exposing a newly recovered file. Already verified local bytes remain available offline.

This checkpoint still does not create a canonical source, publish a financial observation or consume paid AI. Inline receiving setup/list UI, explicit batch admission with atomic Outbox/private sync/conflict policy, and reuse of existing canonical import/document/photo workflows remain required before the complete email feature is reviewable for delivery. No receiving webhook has been activated and no claim of email-to-business-data or device acceptance follows from original recovery alone.

## Authenticated admission and private synchronization — 20 October

A received email is still not a user instruction. Its owner makes one explicit ADMIT or DISMISS choice from the bound conversation. Admission selects stable attachment/processing identities, with separate AUTO, waste-ticket and store-photo intentions; only explicitly grouped ticket views share a processing identity and retain the existing five-view bound. The receipt UUID identifies its immutable admission aggregate; the human action UUID is also its immutable Outbox command UUID. A different first choice from another device becomes a domain conflict, rather than a last-write-wins update or a second processing permission.

Local migration 53 and Mongo migration 46 precede repository use. The SQLite decision and command commit together. Human confirmation reads bounded local metadata only, without binary I/O or waiting for a download; it records explicit absent proof if no verified local manifest exists. Actual verified bytes remain mandatory for processing. The existing private chat synchronization path owns push, processed-command replay, negotiated owner-filtered bootstrap/pull, ACK, failures and conflicts; no separate synchronization service is added. Old clients do not receive the new entity without both history and email-intake capabilities. Current manager/membership/conversation checks run before cached-command replay and inside mutation. Private bootstrap and pull also batch-check current manager membership and active owned conversations before returning email decisions. A bounded private history is protected at admission before exceeding the existing 500-row bootstrap policy; source files remain retained on refusal.

The server revalidates attachment identities and, when ready, the same immutable original manifest used by download access. Pending/failed original preservation may be included in the user's selected batch with an explicitly absent checksum/manifest proof; admission does not pretend those bytes are ready. The later file pipeline must wait for the actual ready original, validate its scoped manifest and hash and preserve ordinary format/source classification rules before use. This allows one human confirmation to cover attachments that finish preservation later. Known stale or contradictory proofs, changed/withdrawn sources and unsupported admission metadata are rejected. Confirmation changes neither a READY file into APPLIED nor a CONFIRMED batch into COMPLETE, creates no business source and triggers no paid analysis by itself.

Native handling preserves dirty local choices against remote snapshots, records a conflicting accepted choice separately, and allows only explicit adoption of that immutable accepted choice. A rejected local attempt may be superseded explicitly after fresh source checks: keep its original Outbox payload/history, create a new action UUID and never silently rearm the refused command. Pending decisions, raw files and other field actions survive rollback, restart and actor changes. Canonical processing, per-file completion/retry controls, inline native receiving/configuration/cards and real provider/device acceptance remain part of the same unfinished V1 delivery.


## Bounded private decision-history restoration

The email capability is not yet delivered or activated. Its next compatible API/native delivery changes the initial snapshot to an `emailIntakeHistoryRequired` signal plus the authenticated owner. It does not embed all attachment proofs. The authenticated `/api/v1/intake/email/decisions` route is available independently of provider activation, so deactivating reception does not remove recovery of accepted private choices. It returns at most 50 immutable decisions and a store/owner-bound opaque continuation. Current manager membership and active owned conversations govern every page; source and financial collections are untouched.

Native bootstrap commits the normal business snapshot, then applies bounded private pages through the existing decision applier and SQLite transaction. Clear a stale adoption marker at the new snapshot; mark it complete only after the final page. A lost connection leaves the prefix and pending choices intact, and an interrupted bootstrap remains eligible for retry. Rows committed after the base snapshot remain covered by its normal incremental cursor, including UUIDs before the history continuation. Invalid/foreign/looped page responses fail without adopting incomplete history. Keep the existing 500-choice admission/history policy explicit; this increment fixes transport size without silently reducing that policy or claiming unbounded history. Reader accounts skip this manager capability and continue their ordinary synchronization.

Mongo migration 47 adds only the page-read index. No local schema, source IDs, publication rules, formulas, model instruction or provider setting changes. This is an API-compatible-delivery-before-native requirement, not a reason to start a separate paid EAS build.
