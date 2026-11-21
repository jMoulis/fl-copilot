# Product catalogue and procurement offers

Owner-approved direction, 21 November 2026. This first increment defines the model
and a deterministic identity preview; it does not change import behavior or persist
new business entities. React Native/Expo, SQLite, Outbox, MongoDB, stable Product IDs
and deterministic analytics remain canonical.

## Purpose and approved boundary

A manager imports the Mercalys reference workbook, the ordering application's JSON,
then historical sales/waste ZIPs. One useful commercial Product exposes its confirmed
source identifiers and associated procurement offers. An offer is not another Product.
The owner prefers a clean beta reset to preserving every test record, but deletion
requires a later concrete approved scope and a successful empty-base rehearsal.
No purge, production reassignment or unattended catalogue mutation is authorized by
this specification. Current account/store settings stay out of the intended reset.

The first product lot covers catalogue identities, dated procurement tariffs and a
batch of proposed enrichments. Importing orders, receipts, promotion planning,
weather/news and new AI recommendations is deferred. Source JSON examples include
those sections; their presence must not silently expand this lot.

## Identities and authorities

| Concept | Identity and responsibility |
| --- | --- |
| Product | Existing store-scoped UUID, consumer/commercial identity, analytics, field events, photos, substitutions and plans. |
| Mercalys reference | Source ITM/EAN and explicit optional PLU. Retain source and review evidence; multiple names or suffixes do not imply equivalence. |
| Ordering generic | Exact source genericId/genericName in its provider namespace; not globally a PLU. A confirmed link targets the existing Product identity. |
| Procurement offer | Exact provider offer ID (_id), including packaging identity. productId alone cannot replace it; preserve packagingCode. Several offers can serve one generic/Product. |
| Mercalys PA | Existing dated price observation for the validated source reference; its authority/history remain separate from ordering quotes. |
| Procurement tariff | Imported offer/base/as-of quote with source priceUnit, available delivery windows and conditions. Not a realized cost of goods sold or stock estimate. |

Reusing Product is preferred to adding a second commercial catalogue. A matching
ordering generic does not merge distinct Mercalys references or reassign their old
observations. Two homonymous source references remain distinct unless their business
equivalence has been explicitly established. Preserve full identifiers as strings.

The current Domain ProductIdentifier already supports PLU. Supplier ordering IDs
must not be inserted as ITM8, EAN or PLU. Do not reuse promotional CommercialOffer
as a procurement offer, or write procurement quotes into one-PA-per-product/date
history. Store-specific PV overrides, promotional sellingPrice and actually realized
Mercalys sales remain different facts.

## Crosswalk preview v1

The shared pure module packages/domain/src/procurement-crosswalk.ts accepts only
source offer identities and normalized Mercalys reference identities. It performs
no writes, network requests, price conversion, source creation or activation.

1. Group offers by the exact genericId. Keep all offer IDs; conflicting names or
   duplicate offer IDs require review rather than choosing one by order.
2. An exact explicit Mercalys PLU can produce PLU_MATCH when unique.
3. The observed supplier convention proposes ITM8 = 87 + genericId padded to six
   digits, only for positive numeric generic IDs of at most six digits. Require the
   complete constructed ITM to exist. This yields ITM_CANDIDATE, never an approved
   link. No arbitrary last-four/last-five suffix or label matching.
4. Compare 8-digit ITMs with the supplied 13-digit representation only when it has
   exactly five leading zeroes. Do not strip zeroes from PLUs, EANs or generic IDs.
5. A non-unique PLU/ITM, contradictory owners, derived ITM with an explicitly different
   PLU, or two different generics targeting one reference yields REVIEW. Row order
   cannot select a winner. No candidate yields UNMATCHED.
6. Label agreement is descriptive: exact, prefix-compatible or different. A prefix
   does not prove truncation, and an equal label never establishes a relationship.
7. All preview rows remain proposals until the user confirms publication. Preserve
   method, original codes, source indexes/checksum, actor/time and mapping version.
   Reimport preserves reviewed links and flags changed evidence instead of relinking.

Real exports: 691 offers, 484 generics, 1,226 Mercalys references. Preview gives 88
PLU_MATCH, 333 ITM_CANDIDATE, one REVIEW and 62 UNMATCHED. Six linked/candidate labels
differ beyond exact/prefix comparison and remain inspectable. Carrot generic 5002
has four distinct offers. Nina 3435 resolves through explicit PLU despite its ITM
ending 7466. Tomato generic 4820 versus explicit PLU 7349 requires review even with
an exact label. These examples are regression evidence, not hard-coded exceptions.

The previous raw analysis counted that tomato among 334 constructed candidates;
the executable crosswalk intentionally upgrades it to REVIEW. Source dates are
21 November 2026. Private full crosswalk and source hashes remain outside the repo
under maintenance/full-payload-analysis-2026-11-21/canonical-crosswalk.json.

## Units, packaging and enrichment batch

Keep the following independent:

- Mercalys source management/quantity unit as supplied;
- the Product unit used to interpret imported historical movement quantities;
- retail nature and packaging content, e.g. one 250 g tray;
- procurement tariff basis, per supplied weight versus per sale unit;
- logistical packaging quantity/name/code and supplied weight.

Never assign Product.salesUnit = PACK/PIECE merely because priceUnit is true, or
KG merely because the source management unit says kg. Decimal movement quantities
for packaged goods retain their original meaning. No division of PA by quantity
or weight until a specific conversion and source units have been validated.

Example: tomato 250 g, 16 trays, weight 4 and priceUnit true supports a per-tray
quote and a logistical 16-tray pack; the source kg management unit is not proof
of a PA per kg. A blank versus zero receivedQuantity is also distinct.

The supplied JSON's order totals are consistent for 2,587 lines with priceUnit:
true uses PA * packagingQuantity * quantity; false uses PA * weight * quantity,
using receivedQuantity instead of quantity when the former is explicitly present.
53 other lines omit priceUnit. This is observed source arithmetic, not authority
to derive live stock, complete receipts or a realized COGS calculation. Orders
remain outside the first importer.

The enrichment batch proposes category, retail nature, analytic unit and packaging
with source evidence and explicit unknowns. Source nomenclature and Nature Produit
PNM/Autres do not automatically define our categories or BULK/PACKAGED. Mark Petit
Prix only with appropriate source evidence. Owner reviews exceptions before the
batch is applied through existing canonical writers; no silent historical rewrite.

## Persistence and synchronization implementation contract

No migration or runtime sync entity is introduced by this first increment.
Before persistence work, extend shared Zod contracts, source types/access rules,
SQLite/Mongo migrations, serializer, conflict and replay policies together.

Reuse immutable source documents and source_records for catalogue snapshots and
normalized offer rows where their contracts fit. A snapshot retains the original
checksum, relevant normalized fingerprint, source as-of and import timestamp. Each
offer row preserves its exact ID, generic identity, product/packaging IDs, labels,
origin when supplied, weight/quantity, and optional assortment tariff with its base,
priceUnit, delivery windows, order deadlines, indispo and complementaire flags.
An offer absent from the current 421 assortment tariffs has an unknown current
quote, not zero, unavailable stock or automatic deactivation. Omission in a future
snapshot never erases prior offers or quotes.

A validated generic-to-Product relationship must have one canonical local table,
remote durable representation, audit evidence, expected-version conflict policy
and an atomic Outbox write. The bulk catalogue snapshot and its review decisions
must publish atomically/idempotently; avoid thousands of per-offer sync commands.
Do not overload MERCALYS_PUBLISH with non-Mercalys JSON. Introduce the needed
canonical command/capability only after its full local/remote contract is defined.
This is one source ingestion path, not an independent catalogue service or agent.

The full JSON also contains order usernames and potentially private metadata.
Retain the original under owner-scoped private access; do not inherit the generic
STORE access of existing source types. The first normalized shared catalogue omits
orders, commitments, weather, news and unrelated account fields. Reuse the existing
private source pipeline, with explicit source-type authority and access tests.

Both local and API adapters use shared parsing/crosswalk logic. The API verifies
accepted normalized data against the immutable original, source PDV and current
store authority. Old clients require capability gating. An older API leaves work
pending safely. Server compatibility precedes any native release.

## Import and product UX to prototype before integration

Imports exposes Reference catalogue, Ordering offers JSON and Sales/waste ZIPs.
Each file first shows scope/date, proposed links, offers with tariffs, unmatched
references and changes. One explicit confirmation applies ready rows; exceptions
remain optional and cannot prevent unrelated ready rows. No barcode lookup, file
selection, email reception or AI message can validate an ambiguous link.

Product detail keeps its current route and Back context. Show commercial identity
and codes, then a concise Offers section with tariff source/date, origin/calibre,
price basis, packaging and forthcoming delivery windows. A reference PA and an
offer quote have explicit separate labels; no arbitrary 'best' PA is chosen.
Unknown units/price dates remain visible. Draft/prototype approval precedes UI
integration. Existing bottom-sheet gesture and navigation fixes remain intact.

## Delivery sequence and completion criteria

1. Model/crosswalk proof (this increment): shared identity contracts, pure preview,
   conflict regressions and real-export dry run. No runtime import changes.
2. Snapshot/parser/persistence: shared source schema first, migrations, atomic
   publication, original verification, private access, scoped sync and replay.
3. Enrichment proposals and short exception review, without conflating source units.
4. Product/import mockup review, then implementation with offline/reopen behavior.
5. Empty-base rehearsal: reference -> JSON -> sales/waste ZIPs, repeat/interruption,
   second device, exact monetary controls, two legacy references and ticket mapping
   policy. Existing partial rehearsal is not full replay or rollback qualification.
6. A concrete reset inventory plus final owner approval, then a grouped local iPhone
   build and native recipe. Keep account/store settings. No automatic production
   purge, bulk archive, new AI spending, paid EAS build or public distribution.

Commands/receipts, weather/news and new merchandising/AI tools remain deferred.
The canonical per-100 sync drain fix from PR 557 is merged but not in build 89.
EMAIL_INTAKE_ORIGINAL_CHANGED was reported separately; owner confirmed a complete
sync, not a diagnosed/accepted email fix. Deferred Atlas snapshot/isolated-restore
reserve stays open; do not turn this local proof into a claim of server recovery.
