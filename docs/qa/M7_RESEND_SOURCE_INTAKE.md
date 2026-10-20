# Resend intake — L8/M7 documents

Status: local implementation branch, not a delivered email intake. No provider webhook, account setting, DNS, environment file, source-file fetch, paid analysis or EAS build was changed/triggered. The owner has been asked for the actual managed receiving address; independent implementation continues.

## Implemented checkpoint

- Actual Resend SDK verifies the bounded exact raw body, signature age and header shape. Fastify parser encapsulation preserves normal API JSON parsing. Rejected metadata has no privileged side effect.
- Mongo migration 45 adds opaque immutable/revocable recipient bindings, private envelope/file identities and an event ledger. Setup and reads require the current active manager and owned active conversation. Recipient setup UUIDs remain stable on retry and cannot be retargeted or reactivated.
- Event/envelope admission is transactional. Concurrent deliveries retain one receipt and its original file IDs. Semantic contradictions quarantine that same receipt without replacing metadata or republishing. A failed ledger write rolls back receipt creation and returns 503 for retry.
- Unknown senders/recipients, ambiguous destinations, revoked roles/membership, removed/archived conversations and empty messages leave minimal durable ignore records. No rejected sender/body/recipient text is logged or stored in the ignore ledger.
- Authenticated setup/list/revoke routes and typed API-client methods use store/owner from authorization. Scoped pagination and no-store responses protect receipt metadata. The SDK/API capability is disabled by default; complete explicit receiving configuration is required. No secret/download URL/HTML/email-body text is a public DTO.

## Current local evidence

- 88 tests pass across actual raw-signature/Fastify, real disposable Mongo integration, public contracts and existing application/source-original routes.
- Two additional API-client tests pass (90 distinct targeted tests total); the shared contract pair was also rechecked with them.
- All ten TypeScript projects pass; lint, formatting and API build/import pass at this checkpoint.
- First full regression: 3,008 tests passed, with six suites failing solely in cold Mongo `beforeAll` hooks at the former 10-second deadline (33 tests did not run). All 33 tests then passed in a focused replay. The preparation-hook deadline is now 60 seconds; ordinary test deadlines/assertions are unchanged. A complete replay is running; no final full-suite success is inferred yet.

## Remaining in this same delivery lot

1. Provider attachment capability/identity/expiry/bounds checks and immutable private original retention, durable work/leases/retry/authorization, without fetching HTML or depending on old signed URLs. Preserve originals before processing readiness.
2. Native SQLite/cache, inline receiving configuration and pending-file card in the correct chat; explicit batch admission + Outbox with fresh snapshot/conflict checks, offline/restart and account-change protection.
3. Reuse existing PDF/XLSX/ZIP/photo pipelines and canonical dedup/reconciliation. Distinguish independent receipt photos from a multi-view ticket and ask only consequential classification/identity questions. Preserve all existing original files and user decisions.
4. Full source-to-chat-to-business-data integration and two-device proof. No official import/publication, analysis or source document is created by the current envelope metadata gate.
5. Obtain/provision the managed receiving domain, receiving-capable application credential and signing secret through authorized secure configuration. Deploy a compatible complete endpoint before registering a provider webhook; verify real receiving and rollback without sending unauthorized messages or spending.
6. Grouped native/real-provider acceptance. Resend/M7 documents and full V1/M8 remain open until these paths are delivered and exercised.
