# Monthly quantity grouping — 6 November 2026

## Reproduced defect and change

The successful monthly Copilot answer still could not provide department quantities by unit. Its recorded Mongo pipeline grouped by `_id.year` and `_id.unit`, then sorted by those nested keys. The validator rejected the dotted sort keys before database access, although equivalent nested expression references were already allowed.

Reuse the existing expression-reference validation for sort paths: every segment must pass the existing safe-key check and the root must belong to the current public view or an earlier stage output. Other stage destination keys and filters keep their existing checks. Private roots, prototype keys, operators, empty segments and removed roots remain refused. Store scoping, read-only stages, row/time/evidence limits and the incompatible-unit guard are unchanged. No prompt, schema, provider or model-budget change.

## Verification

The two new monthly regression cases fail against the previous implementation (`INVALID_QUERY`), then pass after the correction. The complete focused run passes **67 tests across three suites, zero skipped**, including real isolated MongoDB execution through the canonical reader, quantities separated by year/unit, date boundaries, foreign-store exclusion, nested source evidence, null preservation, unsafe path refusals and shared sales-measure tests.

Full typecheck, lint, formatting, API build and exact-head CI/release results are recorded separately. This document does not imply deployment or a new physical-device recipe.

## Fractional piece quantities — data investigation only

Read-only inspection of the current store confirms that both banana-ribbon references are catalogued as `PIECE`. The owner confirms they are sold at a fixed price per ribbon. Fractional values already occur in retained Mercalys source records, before Copilot calculations: the organic reference has source quantity 20.53 on 14 October; the Petit Prix reference has observation quantity 29.6 on 16 October. The former is identically retained in raw and normalized source payloads and the published observation. This rules out the answer formatter introducing those decimals, but does not establish why the source uses them.

Do not round them, convert to KG, rewrite immutable source records or silently reclassify the catalogue. The reason for these source fractions remains unresolved; a recorded quantity is not necessarily a verified physical article count. No production business data was changed and no paid AI request was made.
