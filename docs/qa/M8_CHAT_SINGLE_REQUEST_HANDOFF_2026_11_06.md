# M8 — one-request chat intake, 6 November 2026

## Owner regression and actual boundary

The owner reports that background completion/notification works after streaming starts, but leaving immediately during preparation stalls until returning. Build36 is therefore **partially verified, not accepted for immediate background dispatch**. Read-only production evidence correlates the latest plain question created at 05:10:37 UTC with canonical push completion at 05:10:38, pull completion at 05:10:42 and the turn request only at 05:12:00. Generation and notification cannot start before the phone sends that second request. Removing file jobs in PR454 was insufficient: the client still awaited a complete push/pull and its local continuation.

## Reuse and change

The existing turn HTTP request can optionally carry the exact pending canonical Outbox commands for that plain question and its conversation. The server reuses the same authorized push handler as `/sync/push`, including device/store/owner checks and transactional command journal. Turn authorization precedes intake; every supplied command must be applied/already applied before reading parent/history or generating. Existing turn lease, cached response, persistence and opted-in `waitUntil`/push notification paths remain the owners of generation. Lifetime protection covers intake as well as generation.

The native sync service reads a bounded packet without mutating/acknowledging Outbox state, waiting for a pull or introducing another SQLite writer. Stable command/question/reply IDs are unchanged; the normal synchronization cycle later acknowledges/replays them idempotently. Commands already selected as SYNCING are included to handle ordinary-sync races. Foreign owners, unrelated business commands and attached questions are excluded. Attachments retain their existing preparation workflow. Previously synchronized plain questions can request a turn without an unrelated sync first.

The empty activity label now says “Envoi de ta question”; actual server PREPARING activity still says “Préparation de la réponse”. No new collection, migration, queue, timer, model context or business-action authorization is introduced. The API must be released before the upgraded native binary. Old ID-only clients remain supported; retain the previous API/mobile pair for rollback.

## Evidence and limits

**188 tests across 14 suites pass, zero skips**, with a disposable localhost MongoDB replica set: canonical intake and real response persistence after HTTP disconnect before first activity; one notification attempt; ordinary sync returns ALREADY_APPLIED; retry produces one reply/notification; forged owner/device is refused. The isolated generation test uses the existing unconfigured-provider fallback, not a paid OpenAI call or production data. Mounted lifecycle tests independently gate intake and verify lifetime registration before releasing it. SQLite tests prove an unsynchronized/SYNCING plain question reaches the single request without any preceding sync/pull, keeps exact journal IDs and does not fabricate acknowledgement. Existing history, lease/response, client scope, Outbox, sync, notification and native chat suites remain green.

All ten workspace typechecks, targeted ESLint, API bundle/import and iOS export pass. Production reads are diagnosis, not an end-to-end production test. No credentials, push token bytes or private original bytes were logged; no production test question was sent.

Native physical acceptance remains open: send a plain question and immediately background the iPhone before streaming; receive one alert and reopen the completed owned reply without a second question/answer. This guarantees server continuation **after the HTTP request has reached it**, not delivery of a request that has not left an offline/suspended device. No full M8 closure is claimed.
