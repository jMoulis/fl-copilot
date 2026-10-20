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
- First full regression: 3,008 tests passed, with six suites failing solely in cold Mongo `beforeAll` hooks at the former 10-second deadline (33 tests did not run). All 33 tests then passed in a focused replay. The preparation-hook deadline is now 60 seconds; ordinary test deadlines/assertions are unchanged. The complete replay of the envelope checkpoint (`15fc0c8`) passed: **3,041 tests / 6 skipped** across 377 passing files and one skipped file.

## Remaining at the envelope checkpoint (updated below)

1. Provider attachment capability/identity/expiry/bounds checks and immutable private original retention, durable work/leases/retry/authorization, without fetching HTML or depending on old signed URLs. Preserve originals before processing readiness.
2. Native SQLite/cache, inline receiving configuration and pending-file card in the correct chat; explicit batch admission + Outbox with fresh snapshot/conflict checks, offline/restart and account-change protection.
3. Reuse existing PDF/XLSX/ZIP/photo pipelines and canonical dedup/reconciliation. Distinguish independent receipt photos from a multi-view ticket and ask only consequential classification/identity questions. Preserve all existing original files and user decisions.
4. Full source-to-chat-to-business-data integration and two-device proof. No official import/publication, analysis or source document is created by the current envelope metadata gate.
5. Obtain/provision the managed receiving domain, receiving-capable application credential and signing secret through authorized secure configuration. Deploy a compatible complete endpoint before registering a provider webhook; verify real receiving and rollback without sending unauthorized messages or spending.
6. Grouped native/real-provider acceptance. Resend/M7 documents and full V1/M8 remain open until these paths are delivered and exercised.

## Attachment transport checkpoint

`resend-attachment.ts` now supplies the bounded provider adapter, with **32 targeted tests** and API type/lint checks. This new test file was added after the full envelope suite was collected, so its result is additional evidence and is not folded into that full-suite count. That transport-only checkpoint did not wire it into processing; the later private-preservation checkpoint below now wires its worker, not business processing.

The adapter uses the authenticated SDK attachment endpoint and the exact documented CDN host/email/file path. It validates metadata identity/expiry/size, blocks redirects and foreign hosts/credentials, omits authorization/cookies on CDN reads, rechecks the scoped callback around I/O, bounds actual bytes, cancels blocked reads and returns SHA-256 with the unchanged original bytes. Signed URLs/provider bodies never become output/errors or durable state. The installed SDK metadata call cannot physically accept an AbortSignal; cancellation stops waiting, handles late settlement and prevents any late download. Body transport uses an actual AbortSignal.

The returned MIME is explicitly **declared** metadata, not a claim of parsed business validity. A worker must persist immutable originals first, then reuse the existing format/classification/import checks before marking them usable or publishing. The adapter does not itself persist a file, create a source, process a workbook/PDF/photo, enqueue an analysis or expose a native approval card. All provider/HTTP paths in these tests are ports; no live provider download occurred.

## Private preservation and durable dispatch checkpoint — 20 October

**149 targeted tests pass across eleven files**, including 20 new real-Mongo original-preservation scenarios, the earlier envelope/authentication/signature/transport tests, the shared/client contracts and 40 existing application tests. All ten TypeScript projects passed; the final API TypeScript check, changed-file lint and API bundle/build import also pass. This is focused evidence on top of the earlier full envelope regression, not a claim that a new full-repository regression has run on all preservation changes.

Evidence now covers transactionally created jobs and rollback, actual signed Fastify admission with mocked queue failure/replay, existing-client event dispatch, single-claim concurrency, exact original proof/private SDK options, aggregate reservation races, partial success, lost acknowledgements/restart without fresh provider URLs, corrupt or changed bytes, revoked/archived scopes, quarantine, stale leases, exhausted attempts and retained bytes after revocation. Public receipt DTOs expose bounded statuses/error codes, not object keys, leases, proof records or signed capabilities. Canonical source/waste/performance collections remain untouched until admission.

The remaining delivery work is native SQLite/cache and configuration, inline batch admission with atomic Outbox/fresh-snapshot semantics, private original access, reuse of canonical XLSX/ZIP/PDF/photo paths with dedup/reconciliation, two-device/restart/account-switch proof and then authorized real receiving activation. The managed receiving address is still awaiting the owner's input. No receiving webhook has been provisioned, no original was downloaded from a real provider, and this branch is not deployed.

## Ready-original access checkpoint — 20 October

The focused regression now passes **165 tests in twelve files**, including thirteen new real-Mongo access scenarios and actual Fastify/API-client route/response checks. All ten TypeScript projects, changed-file lint, API build/import and formatting pass. No new full-repository regression is claimed at this intermediate checkpoint.

Evidence covers public metadata hashes without private paths, two-minute capability scope, valid foreign-owner/store/conversation/receipt/file refusal, unavailable/quarantined/dismissed records, immutable-key reconstruction, Blob metadata mismatch, revocation during storage/signing, changed metadata after reads, expired capabilities, malformed proof dates, no-store responses and rejection of caller-supplied keys or unsafe download hosts. These tests use fake Blob/signing ports and a disposable Mongo replica set; no real file or provider configuration is changed.

Server original access is implemented locally. Native verified caching/viewing, receipt admission + atomic Outbox, generic private incremental synchronization/conflicts and canonical document/import processing are still unfinished parts of the same delivery lot. This branch has no PR/deployment and is absent from iOS build 2.
