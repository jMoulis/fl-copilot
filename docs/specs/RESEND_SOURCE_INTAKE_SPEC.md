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

## Current evidence — 20 October

The read-only connector inspection found no configured webhooks, no beta inbox objects and zero received messages. This does not prove that the account's managed receiving subdomain is absent. The dashboard requires sign-in; its actual receiving address has been requested from the owner. No account configuration was changed and no email was sent. The installed `resend` SDK is 6.30.0; its actual verification arguments are `webhookSecret` and headers `id`, `timestamp`, `signature`.

`apps/api/src/intake/resend-event.ts` implements the bounded raw-signature/metadata/routing gate. `resend-webhook.ts` supplies the encapsulated Fastify POST handler and awaits an injected durable admission before acknowledgement. Twenty-six tests exercise actual SDK signatures, native Fastify injection, ordinary JSON parser isolation and retriable admission failure. These modules are not wired into `buildApp`, durable Mongo admission, native UI or a provider webhook yet; none of those paths is claimed delivered by these tests.

Official references checked for implementation:

- [Receiving emails and the managed subdomain](https://resend.com/docs/dashboard/receiving/introduction)
- [Retrieve received email](https://resend.com/docs/api-reference/emails/retrieve-received-email)
- [Get email content](https://resend.com/docs/dashboard/receiving/get-email-content)
