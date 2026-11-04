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
