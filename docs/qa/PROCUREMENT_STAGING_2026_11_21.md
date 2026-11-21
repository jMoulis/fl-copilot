# Procurement catalogue — parser and private local staging

21 November 2026. Code-only substep 2(a), after the identity model/crosswalk in
PR 558. No native entry point, server publication, build, deployment or reset.

## Behavior

- Shared Zod projection and deterministic import-core parser accept only catalogue
  articles and current assortment quotes. Other JSON sections stay in the immutable
  original, never the normalized snapshot. Diagnostics contain fixed codes rather
  than raw payload values.
- Require a selected PDV; preserve exact offer/generic codes and source dates.
  Reject duplicate identities/quotes, orphan quotes and invalid/oversized JSON.
  Missing quote, price or priceUnit remains unknown; zero remains zero.
- Local migration 68 indexes an owner/store/checksum draft referencing existing
  source_documents, local_files and a single normalized source_record. Original
  and normalized SHA-256 checksums differ by purpose. The caller supplies an
  already retained app-owned original; staging reads/hashes those bytes before
  parsing, never a separately supplied normalized body.
- One SQLite transaction writes all draft metadata. Original paths remain retained.
  Duplicate retry returns stable IDs. Older source dates remain separate history.
  No Outbox/upload job or Product/PA/sales/waste mutation occurs for a review draft.
- This source type is excluded from the current remote upload contract. It cannot
  accidentally inherit STORE visibility while original JSON includes private orders.

## Evidence

Private isolated rehearsal:
`maintenance/procurement-staging-2026-11-21/verify.mts`, `result.json`,
`rehearsal.sqlite`, `original.json` outside the repository. No production database
or account is used. Source SHA-256:
`f4ba7bd87723aba93cba916b62fa6ffafc2e6869d7a0f7be9edae92f2e6afcac`.

3,370,549 source bytes become a 418,553-byte normalized snapshot: 691 offers,
484 generics, 421 current tariffs (314 priceUnit true / 107 false), 270 missing
tariffs. Local staging took 61 ms in this single Mac run; this is not a native
performance benchmark. Duplicate returned the same draft ID; database close/reopen
returned the same snapshot; another owner could not read it via the repository.
Exactly one draft/source/record/file, zero products, PA, sales, waste, jobs and
Outbox commands. The original copy remains present with the same checksum.

Automated coverage includes parser projection and dates/units, missing versus zero,
source bounds/PDV/UTF-8, duplicate/conflicting IDs, restart and duplicate persistence,
source checksum mismatch, older history, atomic rollback and account-scope change.
The 12 focused suites (241 tests), including existing import-core, source and
migration preservation regressions, pass. All ten workspace TypeScript projects,
targeted lint, formatting, structure and diff checks pass before review. Full
exact-head push and PR CI remain required before merge.

## Remaining boundary

Full step 2(b) is open: reviewed publication, authenticated store-PDV binding,
owner-private upload/original recovery, immutable bulk command, Mongo migration,
local Outbox, capability-gated pull/bootstrap/backfill, server verification against
the original and retry/conflict tests. Then approved product/import mockups and
native integration. No per-offer Product creation or mapping approval is implied.
The beta reset still requires the complete empty-base rehearsal and final scope
approval. Atlas backup/isolated restore remains owner-deferred.
