# M7 — confirmed commercial originals independent of event delivery

## Problem and boundary

Both first and repeated PDF upload completion persisted the private original and registered the canonical `commercialDocumentJobs` record, then awaited `Inngest.send` before responding. A slow/failed event provider could therefore delay or fail the upload ACK although the original was already confirmed. This coupling is verified in code; it is **not evidence of a current provider quota failure** or a diagnosis of the owner's last file.

## Implementation

The Vercel adapter supplies the official `@vercel/functions` `waitUntil` lifecycle. Only the existing commercial event dispatch is registered after durable original confirmation and job registration. The complete route returns `CONFIRMED` with the existing job ID while delivery proceeds. A failed event dispatch retains the PENDING intent for the existing recovery sweep or repeated completion; it never marks extraction or analysis successful. A failed durable registration still fails completion and can be retried against the preserved original.

The portable Node adapter drains the same handled task. If lifecycle registration throws, the same task is awaited rather than dispatched again or orphaned. Provider and lifecycle exceptions are reported using allowlisted code/store/source fields only; raw errors, credentials and signed URLs are not forwarded. No database models, contracts, native migrations, event identities, auth policy, pipeline status rules or provider settings change. The pinned Functions dependency is limited to the Vercel adapter; the upload service remains platform neutral.

`waitUntil` extends the request lifecycle within its function timeout. It is **not durable storage** and cannot make Inngest available during an outage. Mongo remains the durable processing intent. Original-file reading introduced by PR 372 does not wait for this job. Automatic background extraction is still scheduled: this increment does not introduce on-demand extraction or close the original-observation-to-retained-offer write path.

The related native cleanup removes the per-PDF processing/recovery panel from the chat, preserving its original-file link and the Documents recovery screen. It is outside build 15 and awaits grouped native release and device acceptance.

## Verification

- Reinstating the old awaited dispatch makes the actual HTTP regression fail: provider failure returns 500 instead of the expected confirmed 200.
- Actual completion routes with disposable transactional Mongo verify the durable source/job before delayed dispatch resolves; provider failure retains a PENDING job; repeated completion preserves PROCESSING and the stable event identity; mismatched Blob metadata, store access denial and durable registration failure dispatch nothing; canonical completion retry recovers the latter.
- Focused lifecycle tests cover synchronous/asynchronous provider failure, safe metadata, unavailable lifecycle fallback, no double dispatch and failure of the reporter itself. No live Inngest/Blob/model request or production business write is made by these tests.
- Existing source-upload, commercial route and email-original tests are included to check the surrounding intake boundaries.

Local validation: **45 targeted tests in five files**, including actual disposable Mongo; full check **4,442 passed / 724 environment-dependent skips**, ten strict TypeScript projects, lint/structure, formatting and API build pass. Exact CI results and release identity are recorded separately when observed. Transport tests do not establish genuine owner conversation quality, physical native behavior, provider availability, or full V1 acceptance.

Official lifecycle reference: https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
