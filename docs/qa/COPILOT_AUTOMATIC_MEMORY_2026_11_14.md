# Automatic private Copilot memory — owner arbitration, 14 November 2026

The owner explicitly enables automatic memory instead of confirming each new
practice. This supersedes the earlier per-item confirmation requirement for
**new private operating practices only**. It does not authorize operational
actions, product changes, shared employee records or official financial facts.

## Reuse and scope

- A capable native client advertises automatic capture through version 2 of the
  existing memory-suggestions header. Other clients keep manual review.
- The existing canonical response carries at most one nullable memory candidate.
  No separate extraction agent, model or memory-only tool round is added. The
  light dispatcher still routes store/memory matters to the expert. This adds
  schema/input and occasional output tokens; it is not free token usage.
- Reuse exact USER quotations/current-message attribution, the existing proposal
  builder, private TOOL records and local memory repository. A candidate is not
  saved merely because generation finished. Malformed/unknown/oversized memory
  attribution drops the candidate without discarding a valid answer. Streaming
  and final answer projections exclude the internal candidate.
- The native sync cycle records eligible new candidates locally and enqueues
  their canonical command atomically. Only actual creation adds one bounded
  push/pull pass; there is no recursive sync or new scheduled job. Chat-only sync
  and ordinary sync use the same worker. Existing limits remain unchanged.

## Authority, provenance and reversibility

The existing owner UUID (`confirmedBy`) attributes responsibility. Optional
`captureMode: AUTOMATIC` explicitly distinguishes delegated capture from an
individual confirmation; it is creation provenance, retained during later edits.
An automatic record requires a user source. Its immutable proposal timestamp is
the logical creation time, identical on two devices; actual processing/sync times
remain in local metadata and the canonical command/change audit. It never claims a per-item human
approval. The model cannot choose owner/store or write knowledge directly.

The new default-on preference is private to this device/account/store in existing
local metadata. Réglages → Mémoire du copilote exposes its switch, captured
origin, editing and forgetting. Disabling stops automatic capture on that device;
existing memories remain synchronized. Enabling does not backfill old questions.

Source/visibility/supersession and enabled preference are rechecked inside the
SQLite transaction, with cancellation on authority loss. Scope changes cannot
redirect a write. Only an unsent automatic initial creation may adopt the canonical creation time
of the same owned source when another device confirmed it first; source/owner/ID
remain immutable and later pending edits remain protected. Known exact duplicates
do not create another local entry; the
same proposal on two devices does not create another remote entry or history
revision. An automatic creation retry preserves a later manual correction or
forgotten record. Do not claim semantic deduplication of every concurrent
paraphrase across independent proposals.

Handled proposals are not replayed. A forget action also fences automatic
capture of older user declarations, so a delayed/retried proposal cannot silently
restore pre-forget context. A new explicit declaration after that boundary can
become a new candidate. Existing-memory corrections still use the dedicated
editable memory screen; the model does not silently overwrite an existing entry.

## Compatibility and delivery

`automaticMemory=true` independently negotiates provenance on sync bootstrap,
pull and push acknowledgements/replays. Legacy strict clients receive their old
entity shape, and their edits preserve creation provenance remotely. New clients
adopt a new private memory bootstrap marker and require the compatible API.
Shared contracts change first; existing JSON storage and metadata need no new
table, Mongo collection or SQLite migration.

Release the compatible API before delivering the native build. Once automatic
records exist, retain a provenance-aware API as the minimum compatible server
rollback. Older native clients are qualified against the legacy wire projection;
this is not qualification of an in-place native binary downgrade against a newer
local cache. Preserve local copies and unsent commands during any recovery.

## Verification and remaining acceptance

Controlled provider tests exercise normal, missing, invented and oversized
memory candidates in both streaming modes, with one provider request and no
memory tool call. Native SQLite tests cover default/no-backfill, disabled mode,
exact duplicates, correction/disable races, authority loss with transaction
rollback/retry and forgetting. Existing mounted memory conflict/review tests
remain required.

An isolated transactional Mongo/SQLite integration exercises two native stores,
canonical command/ack/pull, old/new bootstrap shapes, legacy editing and an
automatic creation retry after a manual correction, plus foreign-owner rejection.
This is synthetic test data in a disposable local database, not production
business mutation or physical iPhone acceptance. No paid model test is used.

Exact-head checks, merge, API deployment, native identity, TestFlight processing
and owner acceptance are recorded separately in the release receipt. The owner tests build 60 with a new preference, reports automatic recording and
correct recall in a new conversation, and accepts this functional case. Live
provider token overhead remains unmeasured; historical memory is not re-extracted.

Local final evidence: **382 tests pass across twelve suites**, with the Mongo
suites enabled against an isolated local replica set; no suites skipped in this
selected run. Ten workspace TypeScript projects, lint, structure, changed-file
format and API bundle/import checks pass. Build 60 is delivered in private TestFlight and the owner accepts the supplied
iPhone recording/recall recipe. Actual provider overhead remains a separate measure.
