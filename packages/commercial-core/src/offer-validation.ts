import {
  commercialValidatedOfferSchema,
  type CommercialValidatedOffer,
  type CommercialOfferChoice,
  type CommercialWeekPreparation,
  type CommercialVersionDecision,
} from "@fl-copilot/domain";
import { commercialUuidFromText } from "./offer-choice";
import { commercialPreparationOfferIssues } from "./week-preparation";
import type { CommercialComparisonPage } from "./document-version-comparison";
export function commercialValidatedOfferId(
  storeId: string,
  choiceId: string,
  choiceVersion: number,
  digest: (text: string) => Promise<string>,
) {
  return commercialUuidFromText(
    JSON.stringify([
      "fl-copilot/validated-offer.v1",
      storeId.toLowerCase(),
      choiceId.toLowerCase(),
      choiceVersion,
    ]),
    digest,
  );
}
export function commercialOfferValidationSource(
  choice: CommercialOfferChoice,
  pages: readonly CommercialComparisonPage[],
) {
  const p = pages.find(
    (p) =>
      p.id === choice.source.readingId &&
      p.storeId === choice.storeId &&
      p.sourceDocumentId === choice.source.sourceDocumentId &&
      p.checksum === choice.source.checksum &&
      p.status === "READY",
  );
  const op = p?.reading?.operations[choice.source.operationIndex],
    item = op?.items[choice.source.itemIndex];
  if (
    !op ||
    item?.kind !== "OFFER" ||
    op.kind !== choice.operationKind ||
    op.label !== choice.operationLabel ||
    item.label !== choice.rawProductLabel
  )
    throw Error("COMMERCIAL_VALIDATION_SOURCE_INVALID");
  const evidence = (e: (typeof op.evidence)[number]) => ({
    pageNumber: e.pageNumber,
    quote: e.quote,
    region: e.region,
  });
  return {
    sourceFields: [...op.fields, ...item.fields].map((f) => ({
      name: f.name,
      rawValue: f.rawValue,
      confidence: f.confidence,
      evidence: f.evidence.map(evidence),
    })),
    evidence: [...op.evidence, ...item.evidence].map(evidence),
  };
}
export function commercialValidatedOfferSameBusiness(
  a: CommercialValidatedOffer,
  b: CommercialValidatedOffer,
) {
  const data = (v: CommercialValidatedOffer) => {
    const { createdAt, ...rest } = commercialValidatedOfferSchema.parse(v);
    void createdAt;
    return rest;
  };
  return JSON.stringify(data(a)) === JSON.stringify(data(b));
}
export function commercialOfferValidationCurrent(
  v: CommercialValidatedOffer,
  choice: CommercialOfferChoice,
) {
  return (
    choice.status === "RETAINED" &&
    v.storeId === choice.storeId &&
    JSON.stringify(v.choice) === JSON.stringify(choice)
  );
}
export type CommercialPlanIssue = {
  code: string;
  messageFr: string;
  choiceId?: string;
  placementId?: string;
};
/** Readiness is a diagnostic, never a VALIDATED plan state. */
export function commercialPreparationReadiness(
  plan: CommercialWeekPreparation,
  choices: readonly CommercialOfferChoice[],
  validated: readonly CommercialValidatedOffer[],
  preferences: readonly CommercialVersionDecision[] = [],
): CommercialPlanIssue[] {
  const issues: CommercialPlanIssue[] = commercialPreparationOfferIssues(
    plan,
    choices,
  ).map((i) => ({
    code: i.code,
    choiceId: i.choiceId,
    messageFr: {
      MISSING: "L’offre sélectionnée n’est plus disponible.",
      WITHDRAWN: "L’offre sélectionnée a été retirée.",
      CHANGED: "L’offre a changé depuis l’enregistrement du brouillon.",
      OUTSIDE_WEEK: "L’offre ne couvre plus la semaine préparée.",
    }[i.code],
  }));
  if (!plan.offerRefs.length)
    issues.push({
      code: "NO_OFFERS",
      messageFr: "Sélectionnez au moins une offre pour le plan commercial.",
    });
  for (const ref of plan.offerRefs) {
    const c = choices.find(
      (c) => c.id === ref.choiceId && c.storeId === plan.storeId,
    );
    if (!c || c.status !== "RETAINED" || c.version !== ref.choiceVersion)
      continue;
    if (!validated.some((v) => commercialOfferValidationCurrent(v, c)))
      issues.push({
        code: "NOT_VALIDATED",
        choiceId: c.id,
        messageFr:
          "Validez commercialement cette version de l’offre sélectionnée.",
      });
    if (
      preferences.some(
        (d) =>
          d.storeId === plan.storeId &&
          [d.before.documentId, d.after.documentId].includes(
            c.source.sourceDocumentId,
          ) &&
          (d.preference === "KEEP_PREVIOUS"
            ? d.before.documentId
            : d.after.documentId) !== c.source.sourceDocumentId,
      )
    )
      issues.push({
        code: "SOURCE_REFERENCE_REVIEW",
        choiceId: c.id,
        messageFr:
          "Cette offre utilise un PDF différent de votre référence choisie après correction. Revoyez l’offre ou le choix de référence.",
      });
  }
  for (const p of plan.placements) {
    if (!p.offerIds.length)
      issues.push({
        code: "EMPTY_TG",
        placementId: p.id,
        messageFr: `${p.label} : affectez une offre ou retirez cet emplacement du brouillon.`,
      });
  }
  const selected = choices.filter(
    (c) =>
      c.storeId === plan.storeId &&
      c.status === "RETAINED" &&
      plan.offerRefs.some(
        (r) => r.choiceId === c.id && r.choiceVersion === c.version,
      ),
  );
  for (let i = 0; i < selected.length; i++)
    for (const b of selected.slice(i + 1)) {
      const a = selected[i]!;
      if (
        a.productId !== b.productId ||
        a.saleStart > b.saleEnd ||
        b.saleStart > a.saleEnd
      )
        continue;
      if (
        a.mechanism.type === "FIXED_PRICE" &&
        b.mechanism.type === "FIXED_PRICE" &&
        a.mechanism.unit === b.mechanism.unit &&
        a.mechanism.amount !== b.mechanism.amount
      )
        for (const c of [a, b])
          issues.push({
            code: "CONFLICTING_FIXED_PRICE",
            choiceId: c.id,
            messageFr:
              "Deux prix fixes différents sont sélectionnés pour ce produit sur une période commune. Choisissez l’offre à appliquer ou corrigez les dates.",
          });
    }
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = JSON.stringify([
      i.code,
      i.choiceId ?? null,
      i.placementId ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
