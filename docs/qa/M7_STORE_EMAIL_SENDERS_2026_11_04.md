# Store email sender list — 4 November 2026

## Scope and compatibility

The owner requests a configurable exact-address whitelist in Actions → Documents reçus par email. Reuse the existing store mailbox/binding, signed webhook, manager authorization, private receipt/original services and explicit document admission. No new database model, source import bypass, global domain wildcard, provider call or Copilot tool.

A bounded list (1–20 normalized unique addresses) and monotonically increasing sender-policy version live on the existing binding. Old bindings default to their immutable `allowedSender`; existing strict binding/receipt DTOs are unchanged. Authenticated manager-only GET/PUT `/api/v1/intake/email/senders` use store/owner scope and compare the observed version before updating. Configuration is an explicit online administrative action, matching existing mailbox setup/revocation; operational documents remain SQLite-first. No new sync entity/table or Outbox bypass for operational data.

Admission checks the configured list and stores the actual declared sender, never substituting the original owner address. A removed sender cannot submit a new mail, but previously admitted receipts/original jobs remain owned history. An ignored historical webhook is not silently replayed after a policy change. Sender matching remains a routing restriction, not independent proof of email identity; signed provider events and explicit document-processing confirmation remain required.

New clients announce sender-list support when listing receipts. Old clients retain single-sender-compatible lists because their shipped SQLite cache rejects another sender against the old binding DTO. New clients cache authenticated scoped receipts with immutable sender provenance, rather than interpreting today's whitelist as permission to erase yesterday's receipts. No existing source or received document is replaced.

## Native interaction

The existing address card opens “Gérer les expéditeurs autorisés”. Settings load on demand; one address per line, one save button, explicit refresh after a version/network conflict. Invalid/duplicate/wildcard/empty lists are refused. A rejected save retains the draft; a delayed response after a store/binding change cannot replace the current form. Configuration errors do not replace the locally available document list. Physical keyboard/readability and owner acceptance remain separate from renderer tests.

## Focused verification

111 contract, routing, HTTP, API-client, real SQLite cache and mounted-form tests pass; 62 transactional Mongo/original-access tests pass without skips. Added cases cover a second exact sender, rejection outside the list, stale-version/actor refusal, exact original sender, old/new client listing, historical replay refusal, removal without history loss and draft retention. Types, targeted lint and API build/import are checked before delivery. No production whitelist or business data is changed by these tests.

Delivery requires exact-head push/PR checks, merge, master checks, compatible API release then an iPhone build. Native build 28 cannot configure the new list; its existing reception remains compatible. Do not ask the owner to repeat the accepted document processing/import/original-opening tests. A focused new-list configuration/receipt test belongs to the new build.

## Separate analysis-screen diagnosis — no formula change

The owner’s 3 November CA warning is legitimate and independent of waste: remote canonical sales are **2168.10 EUR**, margin **665.89 EUR**; all 147 integrated inputs are known, but the publication still has a WARNING record. `03112026.xlsx` has an ambiguous product line **TOMATE COCKTAIL GRAPPE 500G IT**, source index 90, quantity 2, sales **6.98 EUR**, margin **2.24 EUR**. The current non-superseded sales publication and warning are independently verified. That line is not silently assigned to another tomato or included in official totals.

N-1 is correctly **Tuesday 4 November 2025**, ISO week 45/day 2 like Tuesday 3 November 2026. Its canonical CA is **2213.38 EUR** and margin **720.52 EUR**, available. The current published CA differs by **−45.28 EUR / −2.05%**, shown rounded as −2% in the app; margin differs by **−54.63 EUR / −7.58%**, on partial current inputs. The 147/158 cohort sizes do not by themselves establish missing sales. The warning follows an unresolved sales source, not the lack of waste or a wrong calendar anniversary. Resolve the product identity through the existing import review before interpreting a complete-day total; no production record is repaired automatically.

### Subsequent readback — the sales warning is resolved

Before delivery of build 29, the same record is PUBLISHED/AUTO_MATCH and the canonical 3 November CA is AVAILABLE with 148/148 known inputs: **2175.08 EUR**, versus **2213.38 EUR** on 4 November 2025 (**−38.30 EUR / −1.73%**). Imported margin is **668.13 vs 720.52 EUR** (**−52.39 EUR / −7.27%**). This supersedes the initial partial snapshot above. The agent did not assign the product or change a production observation. A device still showing the earlier status needs the existing synchronization/local refresh, not another automatic product repair.

## Owner UX refinement — explicit add/remove editor

Build 29’s textarea accepts one email per line, with no separator. The owner requests a clearer interaction: replace that field with readable address rows, a single-email input and **Ajouter**, plus **Retirer** per row. Edits remain local until the existing explicit save, with unchanged policy schema/authority/version fencing. Refuse invalid/duplicate additions and an empty saved list. A typed but unadded address blocks save with a useful message instead of being silently discarded. Failed saves retain additions/removals; stale binding responses remain ignored. Three mounted interaction tests, mobile types and lint pass. Mobile-only; no API release, new model, dependency or source reimport. Build 29 keeps the previous textarea until this UI is included in a grouped native release; physical keyboard/row readability remains distinct from renderer proof. Accepted 1/3/4/5 stay closed; workstream 7 advances.

## Delivered and accepted editor — build 30

PR 433’s editor is included with PR 434 in iOS build 30, source `36393b1291239728d13a60e6787fce5ddacfb020`. The exact-source EAS artifact is FINISHED and its downloaded IPA identity/version is verified; API `3353993` remains unchanged. After the compact-card and explicit sender-editor phone checks, the owner confirms **“Ok tout est validé”** on 4 November. The focused editor increment is CLOSED; do not repeat the already accepted document reception/publication/original journeys or this editor recipe without a regression. No production whitelist update, exhaustive sender-admission test or physical cross-device recovery is inferred from that confirmation. See [grouped release evidence](M7_FOLLOWUP_CARD_DETAILS_2026_11_04.md#delivery-and-owner-acceptance).
