import { z } from "zod";
import {
  procurementCatalogueSchema,
  type ProcurementCatalogueOffer,
} from "./procurement-catalogue";
import { procurementProductLinkSchema } from "./procurement-product-link";
import { packagingSchema, productSchema, type Product } from "./products";

export const PROCUREMENT_ENRICHMENT_VERSION = "procurement-enrichment.v1";
export const enrichmentSourceSchema = z.strictObject({
  link: procurementProductLinkSchema,
  catalogueSnapshotId: z.uuid(),
  catalogueChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  catalogue: procurementCatalogueSchema,
});
export type EnrichmentSource = z.infer<typeof enrichmentSourceSchema>;
export type EnrichmentEvidence = {
  referenceDocumentId: string;
  sourceIndex: number;
  label: string;
  excerpt: string;
};
export type EnrichmentField<T> = {
  current: T | null;
  candidates: { value: T; evidence: EnrichmentEvidence[] }[];
  state: "PROPOSED" | "KEEP" | "REVIEW" | "UNKNOWN";
  reasons: (
    | "EXPLICIT_REFERENCE_LABEL"
    | "NO_RETAIL_EVIDENCE"
    | "EXISTING_VALUE_PRESERVED"
    | "CONTRADICTORY_LABELS"
    | "COMPLEX_PACKAGING"
    | "RETAIL_PACKAGING_UNPROVEN"
    | "TRUNCATED_PETIT_PRIX"
    | "ANALYTIC_UNIT_REQUIRES_REVIEW"
    | "CATEGORY_REQUIRES_REVIEW"
  )[];
};
type Packaging = z.infer<typeof packagingSchema>;
type Candidate<T> = EnrichmentField<T>["candidates"][number];
const label = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
function decimal(s: string) {
  const [whole, fraction] = s.replace(",", ".").split(".");
  const head = whole!.replace(/^0+(?=\d)/, "");
  const tail = fraction?.replace(/0+$/, "");
  return tail ? head + "." + tail : head;
}
const packagingKey = (v: Packaging) =>
  JSON.stringify([decimal(v.quantity), v.unit]);
function combine<T>(
  items: Candidate<T>[],
  key: (v: T) => string,
): Candidate<T>[] {
  const result = new Map<string, Candidate<T>>();
  for (const item of items) {
    const k = key(item.value),
      old = result.get(k);
    if (old) old.evidence.push(...item.evidence);
    else result.set(k, { value: item.value, evidence: [...item.evidence] });
  }
  return [...result.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}
function field<T>(
  current: T | null,
  items: Candidate<T>[],
  key: (v: T) => string = JSON.stringify,
  issues: EnrichmentField<T>["reasons"] = [],
): EnrichmentField<T> {
  const candidates = combine(items, key);
  const reasons: EnrichmentField<T>["reasons"] = [...issues];
  if (candidates.length) reasons.push("EXPLICIT_REFERENCE_LABEL");
  if (candidates.length > 1) reasons.push("CONTRADICTORY_LABELS");
  if (current !== null) reasons.push("EXISTING_VALUE_PRESERVED");
  if (!candidates.length && !issues.length) reasons.push("NO_RETAIL_EVIDENCE");
  const conflict =
    issues.length > 0 ||
    candidates.length > 1 ||
    (current !== null && candidates.some((c) => key(c.value) !== key(current)));
  return {
    current,
    candidates,
    state: conflict
      ? "REVIEW"
      : current !== null
        ? "KEEP"
        : candidates.length
          ? "PROPOSED"
          : "UNKNOWN",
    reasons: [...new Set(reasons)],
  };
}

/** Read-only, deterministic proposals. No Product mutation, quantities conversion,
 * supplier-to-retail inheritance, AI, persistence or automatic confirmation.
 */
export function buildProcurementEnrichment(
  rawProduct: Product,
  rawSources: readonly EnrichmentSource[],
) {
  const product = productSchema.parse(rawProduct);
  const sources = z
    .array(enrichmentSourceSchema)
    .min(1)
    .max(1000)
    .parse(rawSources)
    .sort((a, b) => a.link.id.localeCompare(b.link.id));
  if (
    product.deletedAt ||
    product.status === "INACTIVE" ||
    new Set(sources.map((s) => s.link.id)).size !== sources.length ||
    new Set(sources.map((s) => s.link.genericId)).size !== sources.length
  )
    throw Error("ENRICHMENT_LINK_REQUIRED");
  const natures: Candidate<Product["nature"]>[] = [],
    packages: Candidate<Packaging>[] = [],
    petitPrix: Candidate<boolean>[] = [];
  const natureIssues: EnrichmentField<Product["nature"]>["reasons"] = [],
    packageIssues: EnrichmentField<Packaging>["reasons"] = [],
    priceIssues: EnrichmentField<boolean>["reasons"] = [];
  const supplierOffers: {
    catalogueSnapshotId: string;
    asOf: string;
    offer: ProcurementCatalogueOffer;
  }[] = [];
  for (const source of sources) {
    const { link } = source;
    if (
      link.status !== "ACTIVE" ||
      link.storeId !== product.storeId ||
      link.productId !== product.id ||
      source.catalogueSnapshotId !== link.basis.catalogueSnapshotId ||
      source.catalogueChecksum !== link.basis.catalogueChecksum
    )
      throw Error("ENRICHMENT_SOURCE_CHANGED");
    const offers = source.catalogue.offers.filter(
      (o) => o.genericId === link.genericId,
    );
    if (!offers.length) throw Error("ENRICHMENT_GENERIC_MISSING");
    supplierOffers.push(
      ...offers.map((offer) => ({
        catalogueSnapshotId: source.catalogueSnapshotId,
        asOf: source.catalogue.asOf,
        offer,
      })),
    );
    const text = label(link.basis.reference.label);
    const evidence = (excerpt: string): EnrichmentEvidence[] => [
      {
        referenceDocumentId: link.basis.referenceDocumentId,
        sourceIndex: link.basis.reference.sourceIndex,
        label: link.basis.reference.label,
        excerpt,
      },
    ];
    const bulk = /\bVRAC\b/.exec(text);
    const packed = /\b(?:SACHET|FILET|BARQUETTE|RUBAN)(?=\s|\d|$)/.exec(text);
    if (bulk) natures.push({ value: "BULK", evidence: evidence(bulk[0]) });
    if (packed)
      natures.push({ value: "PACKAGED", evidence: evidence(packed[0]) });
    if (bulk && packed) natureIssues.push("CONTRADICTORY_LABELS");
    // Do not interpret a logistical 16 × 250g or an assortment as one retail pack.
    const complex =
      /\b\d+(?:[.,]\d+)?\s*[X×*]\s*\d/i.test(text) ||
      /\+\s*\d+(?:[.,]\d+)?\s*%|\b(?:OFFERT|GRATUIT|BONUS)\b/.test(text);
    const masses = [
      ...text.matchAll(/(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(KG|GR|G)(?![A-Z])/g),
    ];
    const counts = [...text.matchAll(/\b(\d+)\s*(?:FRUITS?|PIECES?|PCS?)\b/g)];
    if (complex) packageIssues.push("COMPLEX_PACKAGING");
    else if (packed && !bulk) {
      for (const m of masses) {
        const q = decimal(m[1]!);
        if (!Number.isFinite(Number(q)) || Number(q) <= 0) {
          packageIssues.push("COMPLEX_PACKAGING");
          continue;
        }
        packages.push({
          value: {
            quantity: q,
            unit: m[2] === "KG" ? "KG" : "G",
            sourceLabel: link.basis.reference.label,
          },
          evidence: evidence(m[0]),
        });
      }
      for (const m of counts) {
        if (Number(m[1]) <= 0 || !Number.isSafeInteger(Number(m[1]))) {
          packageIssues.push("COMPLEX_PACKAGING");
          continue;
        }
        packages.push({
          value: {
            quantity: decimal(m[1]!),
            unit: "PIECE",
            sourceLabel: link.basis.reference.label,
          },
          evidence: evidence(m[0]),
        });
      }
    } else if (masses.length || counts.length)
      packageIssues.push("RETAIL_PACKAGING_UNPROVEN");
    const petit = /\bPETIT\s+PRIX\b/.exec(text);
    if (petit) petitPrix.push({ value: true, evidence: evidence(petit[0]) });
    else if (/\bPETIT\s+PR(?:I)?\b/.test(text))
      priceIssues.push("TRUNCATED_PETIT_PRIX");
  }
  const nature = field(
    product.nature === "UNKNOWN" ? null : product.nature,
    natures,
    JSON.stringify,
    natureIssues,
  );
  if (nature.candidates.length > 1 && packages.length)
    packageIssues.push("CONTRADICTORY_LABELS");
  return {
    ruleVersion: PROCUREMENT_ENRICHMENT_VERSION,
    productId: product.id,
    storeId: product.storeId,
    productVersion: product.version,
    sources: sources.map((s) => ({
      linkId: s.link.id,
      linkVersion: s.link.version,
      basis: s.link.basis,
    })),
    category: {
      ...field<Product["category"]>(
        product.category === "UNKNOWN" ? null : product.category,
        [],
      ),
      reasons: ["CATEGORY_REQUIRES_REVIEW"] as const,
    },
    nature,
    salesUnit: {
      ...field<Product["salesUnit"]>(
        product.salesUnit === "UNKNOWN" ? null : product.salesUnit,
        [],
      ),
      reasons: ["ANALYTIC_UNIT_REQUIRES_REVIEW"] as const,
    },
    packaging: field(
      product.packaging ?? null,
      packages,
      packagingKey,
      packageIssues,
    ),
    isPetitPrix: field(
      product.isPetitPrix ?? null,
      petitPrix,
      JSON.stringify,
      priceIssues,
    ),
    supplierOffers: supplierOffers.sort(
      (a, b) =>
        a.catalogueSnapshotId.localeCompare(b.catalogueSnapshotId) ||
        a.offer.offerId.localeCompare(b.offer.offerId),
    ),
  };
}
