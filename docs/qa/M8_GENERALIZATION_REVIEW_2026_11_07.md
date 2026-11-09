# M8 — generalization review and bounded corrections, 7 November 2026

## Evidence and scope

Six owner-led production app requests on `ca524e29ade17548d8129747d06646e5570aed71` cover reformulation, realized-price coverage, merchandising, store memory, mixed analysis/TG context and an existing commercial PDF. This is a small observational pilot, not a controlled architecture comparison or statistical model benchmark. The planned future-week PDF case was adapted to the existing current-week original; future-week acceptance remains open.

| Case               | Input tokens | Cached input included | Output tokens | Stored response latency | Review                                                                                     |
| ------------------ | -----------: | --------------------: | ------------: | ----------------------: | ------------------------------------------------------------------------------------------ |
| Reformulation      |          390 |                     0 |            57 |                   3.0 s | Owner accepted                                                                             |
| Realized price     |       14,232 |                11,015 |           255 |                   7.4 s | Useful; units missing in visible prose                                                     |
| Merchandising      |        6,778 |                 4,664 |           478 |                  12.7 s | Useful; no tool calls                                                                      |
| Store memory       |        6,734 |                 4,664 |           140 |                   4.1 s | Correct confirmed habits; no tool calls                                                    |
| Mixed analysis/TGs |      125,468 |                40,041 |         1,832 |                  32.1 s | Six expert steps, three discovery calls, one READ_LIMIT; execution context not established |
| Existing PDF       |       34,036 |                 4,664 |           463 |                  10.9 s | No useful TG answer; no original read; one render omission                                 |

All totals include dispatch. Cached input is a subset of input; output includes reasoning. These counters are not a monetary invoice. The historical omitted fragment was not stored; its exact content/cause cannot be inferred from the render counter.

## Corrections within existing components

1. Expose the existing read-only document/original, preparation, saved-plan/declarations, retained-offer and store-settings tools immediately for canonical chat responses. Mutations and specialized capabilities retain deferred discovery/review. Replace the instruction to search again across domains with discovery only for capabilities not already exposed. The preparation description points to current-plan declarations; a draft cannot prove absence of execution. No extra router, agent, business reader, orchestration layer or model request.
2. Repeated identical reads reuse the existing pending entry before consuming the distinct-read allowance. Returned bytes and generation steps remain bounded; new distinct reads retain the existing limits. This removes the accidental quota penalty on cache hits without increasing read limits. A complete private history is no longer exposed as a redundant history read unless source metadata was omitted; unknown/partial histories retain the reader.
3. The existing reference binder canonicalizes an exactly echoed numeric source name or catalogue label to its accepted evidence reference. Numbers in a filename/product label need not discard its whole paragraph. No fuzzy matching, unaccepted record, ambiguous label, arbitrary number, date or URL is admitted. Source observations still require actual PDF delivery, checksum/page checks and existing observation binding. Content-free render error codes now distinguish validation failures without logging private prose.
4. For equal-duration windows whose dates align by weekday, the shared analytical engine compares only days with recorded values on both sides. `current`/`reference` preserve full observed totals, including a recorded waste amount with no reference. `comparedCurrent`/`comparedReference`, changes and ranking use the paired basis. `comparedDays`, original coverage and canonical source detail qualify that scope. Reuse existing evidence IDs where paired values equal totals; otherwise expose distinct verified values. The derived per-read evidence bound follows the supported maximum of twenty groups × three metrics × six values plus scope; read counts, bytes and time ceilings are unchanged. No absence becomes zero. Unequal/unaligned explicit periods retain independent-period semantics. Citation reopening for observed-product sources retains the full headline total and reuses the same shared paired comparison in its comparison panel; other source bases/default analyses remain separate. This shared-client change needs the next mobile delivery for physical-device source-view parity; API results themselves remain compatible with build39.
5. The renderer preserves explicitly recorded kg/piece/pack and realized-price units from canonical evidence labels when prose omits them. It preserves fractional quantities and original raw citation precision; no physical-piece interpretation or kg conversion.

## Verification and limits

Tests exercise a large tool catalogue with document discovery then actual PDF bytes and a grounded qualitative response in both streaming modes. Tool definitions remain stable across that controlled sequence; no extraction, mutation or paid provider request occurs. Additional regressions cover exact numeric filenames, rejected/ambiguous/foreign references, fabricated numbers, units, missing-day ranking and source-view parity. Existing long monthly output and forged-block checks remain required. Scripted transports verify application boundaries, not the model's actual choice of tools or future token savings.

Compared with the previous scripted monthly fixture, immediate commercial definitions add a small upfront input cost; the intended benefit is eliminating repeated discovery/context growth on multi-domain tasks. No measured live savings are claimed before owner retests. Broader M8, cloud restore, future-week PDF and physical-device parity remain separate gates.

Local checks and exact-head CI/release are recorded separately. Owner should retest the failed PDF and mixed analytical request after API delivery; use a new chat for comparable history scope.

### Local evidence before PR

- Final focused provider/render/comparison suites: **341 tests across eight suites pass, zero skipped**.
- Actual Mongo analytical/fact-context suites: **30 tests pass**, including immutable full totals, distinct paired evidence and existing saved-answer replay.
- Five integration suites rerun with reduced concurrency after the broad local run exceeded several five-second test deadlines: **125 tests pass**. The broad run also caught the temporary loss of current waste when no matched reference existed; that implementation was corrected to preserve totals separately, and the analytical integration test now passes. Do not describe the first broad run as successful.
- Ten-project strict TypeScript, lint, formatting and API bundle/import checks pass locally. Exact-head GitHub full transactional checks and final merged-tree delivery remain separate gates.
- The final controlled monthly fixture uses two scripted provider steps and about 118,924 serialized request-input bytes versus 106,937 previously (about +11.2%); this includes explicit paired bases and upfront commercial definitions. This is a measured payload trade-off, not a claimed token reduction. Live mixed/PDF retests must determine whether avoiding discovery/history loops offsets it.

No paid synthetic model request, provider/credential change, production business mutation, new collection or mobile schema migration was performed.

## Original-PDF owner retest and follow-up

The first retest on `1b9ba88` still fails: 20,465 input tokens (7,300 cached included), 485 output, two expert steps, four parallel store/document metadata reads and no original-PDF read. One block fails `INVALID_ANSWER_TEMPLATE`. Lower input on a failed task is not successful optimization. Two owned `semaine45.pdf` records have the same canonical SHA-256. Their identity is a verified source-data finding; the rejected prose was not retained, so it does not establish that duplicates or list numbering caused that exact rejection.

The bounded correction reuses the existing reader and binder:

- Within a commercial-document page, show the newest representative of an exact filename plus canonical SHA-256 pair once. Different hashes or different names remain distinct; invalid/missing canonical hashes are not deduplication evidence. Preserve every source record and exact-ID access. Pagination still uses the last raw consumed row, including a hidden copy, so unrelated originals are not skipped. Waste-ticket discovery is unchanged. This is page-local grouping, not global history deduplication or publication.
- Normalize Markdown ordered-list markers into bullets before grounding. Ordinals are formatting; amounts, prices, dates and unresolved source references in the text remain subject to the existing checks. Source observations still require actual original bytes and page/checksum ownership validation. No new prompt rule or model request.
- Classify rejected template syntax into content-free literal-number, external-link and malformed-marker reasons. Keep existing error messages and strict grounding, without retaining private rejected prose.

Seven selected regression cases fail on the prior runtime, including actual Mongo discovery and both Responses streaming modes. **362 tests across six suites pass after correction, zero skipped**, including original-file delivery, source citations, scope/transactions, quantities/large answers and unchanged scripted monthly request volume. Ten-project strict types and lint pass. Exact-head CI, merge/release and a real owner PDF response remain separate gates. No paid synthetic model request, database model, source deletion or native build is needed for this API-only follow-up.
