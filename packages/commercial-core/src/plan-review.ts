import {
  commercialValidatedOfferSchema,
  type CommercialWeekPreparation,
  type StoreContextSettings,
} from "@fl-copilot/domain";
import { commercialPlanIssues, type CommercialPlanContext } from "./week-plan";
import {
  commercialOfferValidationCurrent,
  commercialOfferValidationSource,
  commercialValidatedOfferId,
} from "./offer-validation";

/** Transient review projection only. No approval exists until the canonical writer runs. */
export async function prepareCommercialPlanReview(
  preparation: CommercialWeekPreparation,
  current: CommercialPlanContext,
  settings: Pick<StoreContextSettings, "version" | "merchandising"> | null,
  digest: (s: string) => Promise<string>,
  observedAt: string,
) {
  const pending = [];
  for (const ref of [...preparation.offerRefs].sort((a, b) =>
    a.choiceId.localeCompare(b.choiceId),
  )) {
    const choice = current.choices.find(
      (c) =>
        c.id === ref.choiceId &&
        c.storeId === preparation.storeId &&
        c.version === ref.choiceVersion &&
        c.status === "RETAINED",
    );
    if (
      !choice ||
      current.validated.some((v) => commercialOfferValidationCurrent(v, choice))
    )
      continue;
    try {
      pending.push(
        commercialValidatedOfferSchema.parse({
          id: await commercialValidatedOfferId(
            preparation.storeId,
            choice.id,
            choice.version,
            digest,
          ),
          storeId: preparation.storeId,
          choice,
          ...commercialOfferValidationSource(choice, current.pages),
          status: "VALIDATED",
          sourceReviewed: true,
          version: 1,
          createdAt: observedAt,
        }),
      );
    } catch {
      // The unchanged canonical checks below report missing/invalid sources.
    }
  }
  const context = { ...current, validated: [...current.validated, ...pending] };
  const issues = commercialPlanIssues(preparation, context);
  const active = settings?.merchandising?.activeTgCount;
  if (
    active !== null &&
    active !== undefined &&
    preparation.placements.length > active
  )
    issues.push({
      code: "STORE_TG_CAPACITY_CHANGED",
      messageFr: `Le magasin déclare ${active} TG actives F&L. Revoyez les TG prévues dans cette préparation avant de confirmer.`,
    });
  return {
    context,
    issues,
    basis: {
      offerRefs: pending.map((v) => ({
        choiceId: v.choice.id,
        choiceVersion: v.choice.version,
      })),
      sourceDigest: await digest(
        JSON.stringify(
          pending.map(({ createdAt, ...v }) => {
            void createdAt;
            return v;
          }),
        ),
      ),
      storeSettingsVersion: settings?.version ?? null,
    },
  };
}
