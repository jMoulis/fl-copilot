import {
  commercialWeekPreparationSchema,
  commercialVersionDecisionSchema,
  type CommercialWeekPlan,
} from "@fl-copilot/sync-contracts";
import type { CommercialPlanContext } from "@fl-copilot/commercial-core";
import type { MongoCommandMutationContext } from "../sync/processed-command-service";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "./offer-choice-sync";
import {
  serializeValidatedOffer,
  type ValidatedOfferDocument,
} from "./validated-offer-sync";
import type { VisualReadingDocument } from "./visual-reading-store";
import type { PreparationDocument } from "./week-preparation-sync";
import type { VersionDecisionDocument } from "./version-decision-sync";
export class CommercialPlanInputChanged extends Error {}
export async function loadWeekPlanContext(
  ctx: MongoCommandMutationContext,
  plan: CommercialWeekPlan,
): Promise<CommercialPlanContext> {
  const storeId = plan.storeId,
    options = { session: ctx.session };
  const prep = await ctx.database
    .collection<PreparationDocument>("commercialWeekPreparations")
    .findOne({ _id: plan.preparation.id, storeId }, options);
  if (!prep || prep.version < plan.preparation.version)
    throw Error("COMMERCIAL_PLAN_DEPENDENCIES_PENDING");
  const parsedPrep = commercialWeekPreparationSchema.parse(
    (({ _id, ...data }) => {
      void _id;
      return data;
    })(prep),
  );
  if (JSON.stringify(parsedPrep) !== JSON.stringify(plan.preparation))
    throw new CommercialPlanInputChanged("COMMERCIAL_PLAN_PREPARATION_CHANGED");
  const choices = await ctx.database
    .collection<OfferChoiceDocument>("commercialOfferChoices")
    .find(
      {
        storeId,
        _id: { $in: plan.preparation.offerRefs.map((r) => r.choiceId) },
      },
      options,
    )
    .toArray();
  for (const ref of plan.preparation.offerRefs) {
    const c = choices.find((c) => c.id === ref.choiceId);
    if (!c || c.version < ref.choiceVersion)
      throw Error("COMMERCIAL_PLAN_DEPENDENCIES_PENDING");
    if (c.version !== ref.choiceVersion || c.status !== "RETAINED")
      throw new CommercialPlanInputChanged("COMMERCIAL_PLAN_CHOICE_CHANGED");
  }
  const products = await ctx.database
    .collection<{ _id: string; label: string; version: number }>("products")
    .find(
      {
        storeId,
        status: "ACTIVE",
        deletedAt: null,
        _id: { $in: plan.productRefs.map((r) => r.id) },
      },
      options,
    )
    .toArray();
  for (const ref of plan.productRefs) {
    const p = products.find((p) => p._id === ref.id);
    if (!p)
      throw new CommercialPlanInputChanged("COMMERCIAL_PLAN_PRODUCT_INVALID");
    if (p.version < ref.version)
      throw Error("COMMERCIAL_PLAN_DEPENDENCIES_PENDING");
    if (p.version !== ref.version || p.label !== ref.label)
      throw new CommercialPlanInputChanged("COMMERCIAL_PLAN_PRODUCT_CHANGED");
  }
  const prefs = await ctx.database
    .collection<VersionDecisionDocument>("commercialVersionDecisions")
    .find({ storeId }, options)
    .toArray();
  for (const ref of plan.preferenceRefs) {
    const p = prefs.find((p) => p.id === ref.id);
    if (!p || p.version < ref.version)
      throw Error("COMMERCIAL_PLAN_DEPENDENCIES_PENDING");
    if (p.version !== ref.version)
      throw new CommercialPlanInputChanged(
        "COMMERCIAL_PLAN_REFERENCES_CHANGED",
      );
  }
  const validated = await ctx.database
    .collection<ValidatedOfferDocument>("commercialValidatedOffers")
    .find(
      { storeId, _id: { $in: plan.validationRefs.map((r) => r.validationId) } },
      options,
    )
    .toArray();
  if (
    plan.validationRefs.some(
      (r) => !validated.some((v) => v.id === r.validationId),
    )
  )
    throw Error("COMMERCIAL_PLAN_DEPENDENCIES_PENDING");
  const readingIds = [
    ...new Set([
      ...choices.map((c) => c.source.readingId),
      ...plan.preparation.placements.flatMap((p) =>
        p.sourceIdea ? [p.sourceIdea.readingId] : [],
      ),
    ]),
  ];
  const pages = await ctx.database
    .collection<VisualReadingDocument>("commercialVisualReadings")
    .find({ storeId, _id: { $in: readingIds } }, options)
    .toArray();
  return {
    preparation: commercialWeekPreparationSchema.parse(
      (({ _id, ...data }) => {
        void _id;
        return data;
      })(prep),
    ),
    choices: choices.map(serializeCommercialChoice),
    validated: validated.map(serializeValidatedOffer),
    preferences: prefs.map((p) => {
      const { _id, ...data } = p;
      void _id;
      return commercialVersionDecisionSchema.parse(data);
    }),
    products: products.map((p) => ({
      id: p._id,
      label: p.label,
      version: p.version,
    })),
    pages,
  };
}
