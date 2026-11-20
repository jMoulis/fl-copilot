# Scan gencode — 20 novembre 2026

## Scope

Owner-approved shortcut next to product catalogue search. Reuses expo-camera
already installed and ProductMasterRepository reads; no dependency, migration,
AI call, remote lookup or source/referential import change. Camera permission
copy mentions scanning as well as receipt photos in both Expo plugins so their
shared iOS permission description remains consistent.

EAN lookup is exact, store-scoped and independent of the catalogue's current
filters and query. The only equivalent encoding accepted is UPC-A (12 digits)
and its zero-prefixed EAN-13. Do not strip arbitrary zeroes, enforce global GTIN
checksums on store codes, fuzzy-match labels or infer the article from a
variable-weight/price barcode. Unsupported codes remain unknown/invalid.

One validated code owner opens the canonical `/product/[id]` push route. Inactive
products remain viewable without reactivation. Unknown, multiple or unvalidated
owners show a result and a new-scan action; nothing is created or reassociated.
No photo is captured, saved or uploaded. Scanning itself performs no writes.

## Automated checks

Real SQLite migrated in memory: exact EAN and leading zeroes, no partial/label/
ITM8 matching, isolation from other stores and deleted identifiers, ambiguous
owners, unvalidated code, inactive reference, UPC equivalence and unchanged
SQLite total_changes across lookup.

Camera component tests mock the optical native module: duplicate events launch
one lookup; unknown result remains without navigation and can scan again; late
responses after Close, background or unmount do not navigate; foreground resumes
the camera; permission and denied-settings paths stay explicit. These checks
are not physical optical or animation acceptance.

Existing catalogue controls and product navigation stress regression included.
Strict mobile TypeScript, lint/format and exact-head push/PR CI gate the merge.

## Physical iPhone recipe — pending

Included with the article referential in local build 0.1.0 (89), source
`a2ecb2adb27f091b34e8fd3f7826272b35487aad`. Exact-head CI passed before
merge. [Delivery and Apple status](BUILD_89_DELIVERY_2026_11_20.md).
Physical optical acceptance is still pending.

1. In Produits, set a search/category filter, scan a known packaged EAN (including
   one outside the active filter), check the correct fiche opens, Back preserves
   the original filters and position. Repeat offline on synchronized references.
2. Scan an unknown code: no product appears or is created. Scan another code,
   close and reopen the camera; no dead control or duplicate product route.
3. Verify first permission request, refusal/settings return, torch and background
   during lookup. Closing the scanner must cancel any delayed navigation.
4. Check shelf/store EAN variants with actual labels. Variable-price/weight
   encoding normalization is deliberately not implemented without its business
   format; an unmatched variant remains unknown rather than a guessed product.

The authoritative article export is included in this grouped release. The scanner
uses the current validated associations, including those confirmed through the
referential; scanning itself never repairs pre-existing code groupings.
