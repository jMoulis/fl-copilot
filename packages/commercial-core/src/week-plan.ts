import {
  commercialWeekPlanSchema,
  type CommercialWeekPlan,
  type CommercialWeekPreparation,
  type CommercialOfferChoice,
  type CommercialValidatedOffer,
  type CommercialVersionDecision,
  type PlannedCommercialOperation,
} from "@fl-copilot/domain";
import {
  commercialUuidFromText,
  commercialOfferProposal,
} from "./offer-choice";
import {
  commercialPreparationReadiness,
  commercialOfferValidationCurrent,
  commercialOfferValidationSource,
  commercialValidatedOfferId,
} from "./offer-validation";
import type { CommercialComparisonPage } from "./document-version-comparison";
type Digest = (text: string) => Promise<string>;
export type CommercialPlanContext = {
  preparation: CommercialWeekPreparation | null;
  choices: readonly CommercialOfferChoice[];
  validated: readonly CommercialValidatedOffer[];
  preferences: readonly CommercialVersionDecision[];
  products: readonly { id: string; label: string; version: number }[];
  pages: readonly CommercialComparisonPage[];
  blocked?: readonly string[];
};
const sorted = <T>(rows: readonly T[], key: (v: T) => string) =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const literal = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase("fr-FR").replace(/\s+/g, " ").trim();
export function commercialWeekPlanId(
  storeId: string,
  weekStart: string,
  digest: Digest,
) {
  return commercialUuidFromText(
    JSON.stringify([
      "fl-copilot/week-plan.v1",
      storeId.toLowerCase(),
      weekStart,
    ]),
    digest,
  );
}
export function commercialPlanRevisionId(
  planId: string,
  version: number,
  digest: Digest,
) {
  return commercialUuidFromText(
    JSON.stringify([
      "fl-copilot/plan-revision.v1",
      planId.toLowerCase(),
      version,
    ]),
    digest,
  );
}
export function commercialPlanSameIdentity(
  a: CommercialWeekPlan,
  b: CommercialWeekPlan,
) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.weekStart === b.weekStart &&
    a.weekEnd === b.weekEnd &&
    a.createdAt === b.createdAt
  );
}
export function commercialPlanPreferences(
  prep: CommercialWeekPreparation,
  ctx: CommercialPlanContext,
) {
  const docs = new Set(
    ctx.choices
      .filter(
        (c) =>
          c.storeId === prep.storeId &&
          prep.offerRefs.some((r) => r.choiceId === c.id),
      )
      .map((c) => c.source.sourceDocumentId),
  );
  return sorted(
    ctx.preferences.filter(
      (p) =>
        p.storeId === prep.storeId &&
        [p.before.documentId, p.after.documentId].some((d) => docs.has(d)),
    ),
    (p) => p.id,
  );
}
export function commercialPlanIssues(
  prep: CommercialWeekPreparation,
  ctx: CommercialPlanContext,
) {
  const issues = commercialPreparationReadiness(
    prep,
    ctx.choices,
    ctx.validated,
    commercialPlanPreferences(prep, ctx),
  );
  if (
    !ctx.preparation ||
    JSON.stringify(prep) !== JSON.stringify(ctx.preparation)
  )
    issues.push({
      code: "PREPARATION_CHANGED",
      messageFr:
        "Le brouillon a changé. Rouvrez la semaine avant de valider le plan.",
    });
  for (const ref of prep.offerRefs) {
    const c = ctx.choices.find(
      (c) => c.id === ref.choiceId && c.storeId === prep.storeId,
    );
    if (!c) continue;
    if (!ctx.products.some((p) => p.id === c.productId))
      issues.push({
        code: "PRODUCT_INVALID",
        choiceId: c.id,
        messageFr:
          "Le produit associé n’est plus actif. Revoyez l’offre avant de finaliser.",
      });
    try {
      commercialOfferValidationSource(c, ctx.pages);
    } catch {
      issues.push({
        code: "SOURCE_INVALID",
        choiceId: c.id,
        messageFr:
          "La source de cette offre n’est pas disponible pour sa validation.",
      });
    }
  }
  for (const placement of prep.placements) {
    const ref = placement.sourceIdea;
    if (
      ref &&
      !ctx.pages.some(
        (p) =>
          p.id === ref.readingId &&
          p.storeId === prep.storeId &&
          p.checksum === ref.checksum &&
          p.status === "READY" &&
          p.reading?.tgIdeas[ref.tgIndex],
      )
    )
      issues.push({
        code: "SOURCE_IDEA_INVALID",
        placementId: placement.id,
        messageFr: `${placement.label} : l’idée source de cette TG n’est plus disponible. Revoyez son lien avant de confirmer.`,
      });
  }
  for (const code of ctx.blocked ?? [])
    issues.push({
      code,
      messageFr:
        "Une donnée de préparation est en erreur ou en conflit. Résolvez-la dans Synchronisation avant de confirmer le plan.",
    });
  return issues;
}
export function commercialPlanNeedsReview(
  plan: CommercialWeekPlan,
  ctx: CommercialPlanContext,
) {
  const issues = commercialPlanIssues(plan.preparation, ctx);
  const refs = commercialPlanPreferences(plan.preparation, ctx).map((p) => ({
    id: p.id,
    version: p.version,
  }));
  if (JSON.stringify(refs) !== JSON.stringify(plan.preferenceRefs))
    issues.push({
      code: "REFERENCES_CHANGED",
      messageFr:
        "Le choix de référence PDF a changé depuis la validation du plan.",
    });
  for (const p of plan.productRefs)
    if (
      !ctx.products.some(
        (current) =>
          current.id === p.id &&
          current.version === p.version &&
          current.label === p.label,
      )
    )
      issues.push({
        code: "PRODUCT_CHANGED",
        messageFr: "Un produit associé a changé depuis la validation du plan.",
      });
  return issues;
}
function natures(
  v: CommercialValidatedOffer,
): PlannedCommercialOperation["operationNature"] {
  const map: Record<
    string,
    PlannedCommercialOperation["operationNature"][number]
  > = {
    prospectus: "PROSPECTUS",
    dramat: "DRAMATIZATION",
    dramatisation: "DRAMATIZATION",
    dramatization: "DRAMATIZATION",
    "coup de poing": "COUP_DE_POING",
    coup_de_poing: "COUP_DE_POING",
    support_to_production: "SUPPORT_TO_PRODUCTION",
    special_range: "SPECIAL_RANGE",
    local_action: "LOCAL_ACTION",
    other: "OTHER",
  };
  const initial =
    v.choice.operationKind === "DRAMAT"
      ? "DRAMATIZATION"
      : v.choice.operationKind === "PROSPECTUS"
        ? "PROSPECTUS"
        : "OTHER";
  return [
    ...new Set([
      initial,
      ...v.sourceFields
        .filter((f) => f.name === "operationNature")
        .flatMap((f) =>
          (f.rawValue ?? "")
            .split(/[,;/|+]/)
            .flatMap((s) => (map[literal(s)] ? [map[literal(s)]!] : [])),
        ),
    ]),
  ] as PlannedCommercialOperation["operationNature"];
}
export async function buildCommercialWeekPlan(
  input: {
    preparation: CommercialWeekPreparation;
    version: number;
    createdAt: string;
    validatedAt: string;
  },
  ctx: CommercialPlanContext,
  digest: Digest,
): Promise<CommercialWeekPlan> {
  const prep = input.preparation,
    issues = commercialPlanIssues(prep, ctx);
  if (issues.length) throw Error(`COMMERCIAL_PLAN_${issues[0]!.code}`);
  const id = await commercialWeekPlanId(prep.storeId, prep.weekStart, digest),
    revisionId = await commercialPlanRevisionId(id, input.version, digest),
    refs = sorted(prep.offerRefs, (r) => r.choiceId);
  const validations = refs.map((r) => {
    const c = ctx.choices.find(
      (c) => c.id === r.choiceId && c.storeId === prep.storeId,
    )!;
    return ctx.validated.find((v) => commercialOfferValidationCurrent(v, c))!;
  });
  for (const v of validations)
    if (
      v.id !==
      (await commercialValidatedOfferId(
        prep.storeId,
        v.choice.id,
        v.choice.version,
        digest,
      ))
    )
      throw Error("COMMERCIAL_PLAN_VALIDATION_INVALID");
  const groups = new Map<string, CommercialValidatedOffer[]>();
  for (const v of validations) {
    const c = v.choice,
      key = JSON.stringify([
        c.source.sourceDocumentId,
        c.operationKind,
        literal(c.operationLabel),
        c.saleStart,
        c.saleEnd,
      ]);
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const operations: CommercialWeekPlan["operations"] = [],
    offers: CommercialWeekPlan["offers"] = [];
  for (const [key, vs] of sorted([...groups], (g) => g[0])) {
    const first = vs[0]!.choice,
      opId = await commercialUuidFromText(
        JSON.stringify(["fl-copilot/planned-operation.v1", id, key]),
        digest,
      ),
      offerIds: string[] = [],
      proposals = vs.map((v) => {
        const page = ctx.pages.find((p) => p.id === v.choice.source.readingId)!;
        const op = page.reading!.operations[v.choice.source.operationIndex]!;
        return commercialOfferProposal(
          op,
          op.items[v.choice.source.itemIndex]!,
        );
      });
    for (const v of vs) {
      const c = v.choice,
        offerId = await commercialUuidFromText(
          JSON.stringify(["fl-copilot/planned-offer.v1", id, c.id]),
          digest,
        );
      offerIds.push(offerId);
      offers.push({
        id: offerId,
        storeId: prep.storeId,
        planId: id,
        operationId: opId,
        productId: c.productId,
        validationId: v.id,
        choiceId: c.id,
        choiceVersion: c.version,
        rawProductLabel: c.rawProductLabel,
        status: "VALIDATED",
        customerMechanism: c.mechanism,
        purchaseCondition: null,
        saleStart: c.saleStart,
        saleEnd: c.saleEnd,
        sourceReference: {
          ...c.source,
          pageNumber: ctx.pages.find((p) => p.id === c.source.readingId)!
            .pageNumber,
        },
        note: c.note,
        version: input.version,
        createdAt: input.createdAt,
        updatedAt: input.validatedAt,
      });
    }
    const announced = (k: "saleStart" | "saleEnd") =>
      proposals.every((p) => p[k] && p[k] === proposals[0]![k])
        ? proposals[0]![k]
        : null;
    operations.push({
      id: opId,
      storeId: prep.storeId,
      planId: id,
      sourceDocumentId: first.source.sourceDocumentId,
      name: first.operationLabel,
      kind: first.operationKind,
      operationNature: [...new Set(vs.flatMap(natures))].sort(),
      announcedStart: announced("saleStart"),
      announcedEnd: announced("saleEnd"),
      plannedStart: first.saleStart,
      plannedEnd: first.saleEnd,
      actualStart: null,
      actualEnd: null,
      applicabilityStatus: "APPLICABLE",
      planningStatus: "PLANNED",
      offerIds,
      version: input.version,
      createdAt: input.createdAt,
      updatedAt: input.validatedAt,
    });
  }
  return commercialWeekPlanSchema.parse({
    id,
    revisionId,
    storeId: prep.storeId,
    weekStart: prep.weekStart,
    weekEnd: prep.weekEnd,
    status: "VALIDATED",
    preparation: prep,
    validationRefs: validations.map((v) => ({
      choiceId: v.choice.id,
      choiceVersion: v.choice.version,
      validationId: v.id,
    })),
    preferenceRefs: commercialPlanPreferences(prep, ctx).map((p) => ({
      id: p.id,
      version: p.version,
    })),
    productRefs: sorted(
      ctx.products.filter((p) =>
        validations.some((v) => v.choice.productId === p.id),
      ),
      (p) => p.id,
    ),
    operations,
    offers,
    groupingConfirmed: true,
    validationConfirmed: true,
    version: input.version,
    createdAt: input.createdAt,
    updatedAt: input.validatedAt,
    validatedAt: input.validatedAt,
  });
}
