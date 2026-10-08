import type { CommercialVisualPageOutput } from "@fl-copilot/domain";
import { commercialOfferProposal } from "./offer-choice";
export type CommercialComparisonPage = {
  id: string;
  storeId: string;
  sourceDocumentId: string;
  checksum: string;
  pageNumber: number;
  pageCount: number;
  status: string;
  model: string;
  schemaVersion: string;
  reading: CommercialVisualPageOutput | null;
};
export type CommercialComparedOffer = {
  readingId: string;
  sourceDocumentId: string;
  pageNumber: number;
  operationIndex: number;
  itemIndex: number;
  operationLabel: string;
  label: string;
  identityKey: string | null;
  identityBasis: "IDENTIFIERS" | "EXACT_LABEL" | "UNKNOWN";
  terms: Record<string, unknown>;
  rawFields: Array<{ name: string; rawValue: string | null }>;
  quotes: string[];
};
export type CommercialSourceDifference = {
  key: string;
  status:
    | "CHANGED"
    | "UNCHANGED"
    | "NOT_FOUND_IN_NEW"
    | "NEW_IN_READING"
    | "AMBIGUOUS";
  before: CommercialComparedOffer[];
  after: CommercialComparedOffer[];
  changedFields: string[];
};
function literal(v: string) {
  return v
    .normalize("NFKC")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}
function sourceOffers(pages: readonly CommercialComparisonPage[]) {
  return pages.flatMap((page) =>
    page.status === "READY" && page.reading
      ? page.reading.operations.flatMap((op, operationIndex) =>
          op.items.flatMap((item, itemIndex) => {
            if (item.kind !== "OFFER") return [];
            const own = (name: string) =>
              item.fields
                .filter((f) => f.name === name && f.rawValue !== null)
                .map((f) => f.rawValue!);
            const labels = [...new Set(own("productLabel").map(literal))],
              identifiers = [
                ...new Set(own("productIdentifier").map((v) => v.trim())),
              ].sort();
            const basis = identifiers.length
              ? "IDENTIFIERS"
              : labels.length === 1
                ? "EXACT_LABEL"
                : "UNKNOWN";
            // A descriptive AI item title is not itself a proven product identity.
            const productKey = identifiers.length
              ? identifiers
              : labels.length === 1
                ? labels
                : null;
            const key = productKey
              ? JSON.stringify([op.kind, basis, productKey])
              : null;
            const fields = [...op.fields, ...item.fields],
              raw = (names: readonly string[]) =>
                fields
                  .filter((f) => names.includes(f.name))
                  .map((f) => [
                    f.name,
                    f.rawValue === null ? null : literal(f.rawValue),
                  ])
                  .sort((a, b) =>
                    JSON.stringify(a).localeCompare(JSON.stringify(b)),
                  );
            const proposal = commercialOfferProposal(op, item);
            const terms = {
              PRICE:
                proposal.mechanism ??
                raw([
                  "sellingPrice",
                  "priceOperator",
                  "salesUnit",
                  "customerMechanism",
                ]),
              DATES: [
                proposal.saleStart || raw(["saleStart", "documentYear"]),
                proposal.saleEnd || raw(["saleEnd", "documentYear"]),
              ],
              PRODUCT: raw([
                "productLabel",
                "productIdentifier",
                "variety",
                "origin",
                "calibre",
                "grade",
                "packaging",
              ]),
              CONDITIONS: raw([
                "purchasePrice",
                "supplierCondition",
                "applicabilityCondition",
              ]),
              DEADLINES: raw([
                "preorderStart",
                "preorderDeadline",
                "deliveryStart",
                "deliveryEnd",
                "executionDeadline",
                "communicationStart",
                "communicationEnd",
              ]),
              BASE_PRICE:
                proposal.mechanism?.type === "CARD_BENEFIT"
                  ? raw(["sellingPrice", "salesUnit"])
                  : null,
            };
            const offer: CommercialComparedOffer = {
              readingId: page.id,
              sourceDocumentId: page.sourceDocumentId,
              pageNumber: page.pageNumber,
              operationIndex,
              itemIndex,
              operationLabel: op.label,
              label: own("productLabel")[0] ?? item.label,
              identityKey: key,
              identityBasis: basis,
              terms,
              rawFields: fields.map((f) => ({
                name: f.name,
                rawValue: f.rawValue,
              })),
              quotes: item.evidence.map((ref) => ref.quote),
            };
            return [offer];
          }),
        )
      : [],
  );
}
function coverage(pages: readonly CommercialComparisonPage[]) {
  if (!pages.length) return { complete: false, ready: 0, total: 0 };
  const totals = new Set(pages.map((p) => p.pageCount)),
    models = new Set(pages.map((p) => `${p.model}:${p.schemaVersion}`));
  const total = pages[0]!.pageCount,
    ready = new Set(
      pages
        .filter((p) => p.status === "READY" && p.reading)
        .map((p) => p.pageNumber),
    );
  return {
    complete:
      totals.size === 1 &&
      models.size === 1 &&
      Array.from({ length: total }, (_, i) => i + 1).every((n) => ready.has(n)),
    ready: ready.size,
    total,
  };
}
export function compareCommercialDocumentVersions(input: {
  storeId: string;
  beforeDocumentId: string;
  afterDocumentId: string;
  before: readonly CommercialComparisonPage[];
  after: readonly CommercialComparisonPage[];
}) {
  if (input.beforeDocumentId === input.afterDocumentId)
    throw Error("COMMERCIAL_COMPARISON_SAME_SOURCE");
  for (const [doc, pages] of [
    [input.beforeDocumentId, input.before],
    [input.afterDocumentId, input.after],
  ] as const) {
    if (
      pages.some(
        (p) => p.storeId !== input.storeId || p.sourceDocumentId !== doc,
      )
    )
      throw Error("COMMERCIAL_COMPARISON_STORE_SOURCE_INVALID");
    if (new Set(pages.map((p) => p.checksum)).size > 1)
      throw Error("COMMERCIAL_COMPARISON_CHECKSUM_INVALID");
  }
  const before = sourceOffers(input.before),
    after = sourceOffers(input.after),
    groups = new Map<
      string,
      { before: CommercialComparedOffer[]; after: CommercialComparedOffer[] }
    >();
  for (const [side, offers] of [
    ["before", before],
    ["after", after],
  ] as const)
    for (const offer of offers) {
      const key =
        offer.identityKey ??
        JSON.stringify([
          "UNKNOWN",
          side,
          offer.readingId,
          offer.operationIndex,
          offer.itemIndex,
        ]);
      const group = groups.get(key) ?? { before: [], after: [] };
      group[side].push(offer);
      groups.set(key, group);
    }
  const differences: CommercialSourceDifference[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => {
      const left = new Set(g.before.map((o) => JSON.stringify(o.terms))),
        right = new Set(g.after.map((o) => JSON.stringify(o.terms)));
      if (
        g.before.some((o) => !o.identityKey) ||
        g.after.some((o) => !o.identityKey) ||
        left.size > 1 ||
        right.size > 1
      )
        return { key, status: "AMBIGUOUS", ...g, changedFields: [] };
      if (!g.before.length)
        return { key, status: "NEW_IN_READING", ...g, changedFields: [] };
      if (!g.after.length)
        return { key, status: "NOT_FOUND_IN_NEW", ...g, changedFields: [] };
      const old = g.before[0]!.terms,
        current = g.after[0]!.terms,
        changedFields = Object.keys(old).filter(
          (k) => JSON.stringify(old[k]) !== JSON.stringify(current[k]),
        );
      return {
        key,
        status: changedFields.length ? "CHANGED" : "UNCHANGED",
        ...g,
        changedFields,
      };
    });
  return {
    beforeCoverage: coverage(input.before),
    afterCoverage: coverage(input.after),
    sameBinary:
      input.before.length > 0 &&
      input.after.length > 0 &&
      input.before[0]!.checksum === input.after[0]!.checksum,
    differences,
    counts: Object.fromEntries(
      [
        "CHANGED",
        "UNCHANGED",
        "NOT_FOUND_IN_NEW",
        "NEW_IN_READING",
        "AMBIGUOUS",
      ].map((s) => [s, differences.filter((d) => d.status === s).length]),
    ),
  };
}
