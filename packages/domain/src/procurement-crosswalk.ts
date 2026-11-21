import { z } from "zod";
import { normalizeProductLabel } from "./products";

const sourceCode = z.string().min(1).max(80);
/** Source identities only. This contract grants no catalogue write authority. */
export const procurementOfferIdentitySchema = z.object({
  offerId: sourceCode,
  genericId: sourceCode,
  genericLabel: z.string().min(1).max(500),
});
export const mercalysReferenceIdentitySchema = z.object({
  sourceIndex: z.number().int().nonnegative(),
  itm8: sourceCode,
  plu: sourceCode.nullable(),
  label: z.string().min(1).max(500),
});
export type ProcurementOfferIdentity = z.infer<
  typeof procurementOfferIdentitySchema
>;
export type MercalysReferenceIdentity = z.infer<
  typeof mercalysReferenceIdentitySchema
>;
export interface ProcurementCrosswalkRow {
  genericId: string;
  genericLabels: string[];
  offerIds: string[];
  state: "PLU_MATCH" | "ITM_CANDIDATE" | "REVIEW" | "UNMATCHED";
  candidates: MercalysReferenceIdentity[];
  reasons: (
    | "DUPLICATE_OFFER_ID"
    | "CONFLICTING_GENERIC_LABELS"
    | "NON_UNIQUE_PLU"
    | "NON_UNIQUE_ITM"
    | "PLU_ITM_DISAGREE"
    | "REFERENCE_PLU_DIFFERS"
    | "MULTIPLE_GENERICS_ONE_REFERENCE"
  )[];
  labelAgreement: "EXACT" | "PREFIX_COMPATIBLE" | "DIFFERENT" | null;
}

function canonicalItm(value: string) {
  return /^00000\d{8}$/.test(value) ? value.slice(5) : value;
}

/** Observed supplier convention, always a proposal rather than a new identity. */
export function proposedMercalysItm(genericId: string) {
  return /^\d{1,6}$/.test(genericId) && /[1-9]/.test(genericId)
    ? `87${genericId.padStart(6, "0")}`
    : null;
}

/** Pure preview. Codes stay strings; labels never create a code relationship. */
export function buildProcurementCrosswalk(
  rawOffers: readonly ProcurementOfferIdentity[],
  rawReferences: readonly MercalysReferenceIdentity[],
): ProcurementCrosswalkRow[] {
  const offers = rawOffers.map((o) => procurementOfferIdentitySchema.parse(o));
  const references = rawReferences.map((r) =>
    mercalysReferenceIdentitySchema.parse(r),
  );
  if (new Set(references.map((r) => r.sourceIndex)).size !== references.length)
    throw Error("PROCUREMENT_REFERENCE_INDEX_DUPLICATE");
  const byPlu = new Map<string, MercalysReferenceIdentity[]>();
  const byItm = new Map<string, MercalysReferenceIdentity[]>();
  for (const r of references) {
    const itm = canonicalItm(r.itm8);
    byItm.set(itm, [...(byItm.get(itm) ?? []), r]);
    if (r.plu !== null) byPlu.set(r.plu, [...(byPlu.get(r.plu) ?? []), r]);
  }
  const groups = new Map<string, ProcurementOfferIdentity[]>();
  const offerCounts = new Map<string, number>();
  for (const o of offers) {
    groups.set(o.genericId, [...(groups.get(o.genericId) ?? []), o]);
    offerCounts.set(o.offerId, (offerCounts.get(o.offerId) ?? 0) + 1);
  }
  const result: ProcurementCrosswalkRow[] = [];
  for (const [genericId, group] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const labels = [...new Set(group.map((o) => o.genericLabel))].sort();
    const plu = byPlu.get(genericId) ?? [];
    const proposedItm = proposedMercalysItm(genericId);
    const itm = proposedItm ? (byItm.get(proposedItm) ?? []) : [];
    const candidates = [
      ...new Map([...plu, ...itm].map((r) => [r.sourceIndex, r])).values(),
    ].sort((a, b) => a.sourceIndex - b.sourceIndex);
    const reasons: ProcurementCrosswalkRow["reasons"] = [];
    if (group.some((o) => offerCounts.get(o.offerId)! > 1))
      reasons.push("DUPLICATE_OFFER_ID");
    if (labels.length !== 1) reasons.push("CONFLICTING_GENERIC_LABELS");
    if (plu.length > 1) reasons.push("NON_UNIQUE_PLU");
    if (itm.length > 1) reasons.push("NON_UNIQUE_ITM");
    if (
      plu.length === 1 &&
      itm.some((r) => r.sourceIndex !== plu[0]!.sourceIndex)
    )
      reasons.push("PLU_ITM_DISAGREE");
    if (!plu.length && itm.some((r) => r.plu !== null && r.plu !== genericId))
      reasons.push("REFERENCE_PLU_DIFFERS");
    const source = candidates.length === 1 ? candidates[0] : undefined;
    const a = labels.length === 1 ? normalizeProductLabel(labels[0]!) : "";
    const b = source ? normalizeProductLabel(source.label) : "";
    result.push({
      genericId,
      genericLabels: labels,
      offerIds: [...new Set(group.map((o) => o.offerId))].sort(),
      state: reasons.length
        ? "REVIEW"
        : plu.length === 1
          ? "PLU_MATCH"
          : itm.length === 1
            ? "ITM_CANDIDATE"
            : "UNMATCHED",
      candidates,
      reasons,
      labelAgreement:
        a && b
          ? a === b
            ? "EXACT"
            : a.startsWith(b)
              ? "PREFIX_COMPATIBLE"
              : "DIFFERENT"
          : null,
    });
  }
  // A candidate cannot silently merge distinct provider generics into one fiche.
  const owners = new Map<number, ProcurementCrosswalkRow[]>();
  for (const row of result)
    if (row.candidates.length === 1 && row.state !== "UNMATCHED") {
      const index = row.candidates[0]!.sourceIndex;
      owners.set(index, [...(owners.get(index) ?? []), row]);
    }
  for (const rows of owners.values())
    if (rows.length > 1)
      for (const row of rows) {
        row.state = "REVIEW";
        row.reasons.push("MULTIPLE_GENERICS_ONE_REFERENCE");
      }
  return result;
}
