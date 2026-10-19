import {
  commercialWeekPreparationSchema,
  type CommercialWeekPreparation,
} from "./commercial-week-preparation";
import {
  commercialWeekPlanSchema,
  commercialPlanRevisionSchema,
  type CommercialWeekPlan,
} from "./commercial-week-plan";
/** Legacy clients keep their old shape. They cannot implicitly remove a linked allocation on write. */
export function legacyPhysicalPreparation(raw: CommercialWeekPreparation) {
  const { physicalAllocation, ...rest } =
    commercialWeekPreparationSchema.parse(raw);
  void physicalAllocation;
  return rest;
}
export function legacyPhysicalPlan(raw: CommercialWeekPlan) {
  const p = commercialWeekPlanSchema.parse(raw);
  return { ...p, preparation: legacyPhysicalPreparation(p.preparation) };
}
export function legacyPhysicalEntity<T>(kind: string, raw: T): T {
  if (kind === "commercial_week_preparation")
    return legacyPhysicalPreparation(
      commercialWeekPreparationSchema.parse(raw),
    ) as T;
  if (kind === "commercial_week_plan")
    return legacyPhysicalPlan(commercialWeekPlanSchema.parse(raw)) as T;
  if (kind === "commercial_week_plan_revision") {
    const r = commercialPlanRevisionSchema.parse(raw);
    return { ...r, plan: legacyPhysicalPlan(r.plan) } as T;
  }
  return raw;
}
