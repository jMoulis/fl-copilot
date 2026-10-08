import {
  commercialWeekPreparationSchema,
  type CommercialWeekPreparation,
  type CommercialOfferChoice,
} from "@fl-copilot/domain";
import {
  commercialChoiceWithinWeek,
  commercialUuidFromText,
} from "./offer-choice";
export function commercialWeekPreparationId(
  storeId: string,
  weekStart: string,
  digest: (text: string) => Promise<string>,
) {
  return commercialUuidFromText(
    JSON.stringify([
      "fl-copilot/week-preparation.v1",
      storeId.toLowerCase(),
      weekStart,
    ]),
    digest,
  );
}
export function commercialPreparationSameIdentity(
  a: CommercialWeekPreparation,
  b: CommercialWeekPreparation,
) {
  return (
    a.id === b.id &&
    a.storeId === b.storeId &&
    a.weekStart === b.weekStart &&
    a.weekEnd === b.weekEnd &&
    a.createdAt === b.createdAt
  );
}
export function commercialPreparationOfferIssues(
  plan: CommercialWeekPreparation,
  choices: readonly CommercialOfferChoice[],
) {
  const p = commercialWeekPreparationSchema.parse(plan);
  return p.offerRefs.flatMap<{
    choiceId: string;
    code: "MISSING" | "WITHDRAWN" | "CHANGED" | "OUTSIDE_WEEK";
  }>((ref) => {
    const choice = choices.find(
      (c) => c.id === ref.choiceId && c.storeId === p.storeId,
    );
    if (!choice) return [{ choiceId: ref.choiceId, code: "MISSING" as const }];
    if (choice.status !== "RETAINED")
      return [{ choiceId: ref.choiceId, code: "WITHDRAWN" as const }];
    if (choice.version !== ref.choiceVersion)
      return [{ choiceId: ref.choiceId, code: "CHANGED" as const }];
    if (
      !commercialChoiceWithinWeek(choice, {
        start: p.weekStart,
        end: p.weekEnd,
      })
    )
      return [{ choiceId: ref.choiceId, code: "OUTSIDE_WEEK" as const }];
    return [];
  });
}
