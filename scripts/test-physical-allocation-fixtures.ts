import { commercialPlanFixture } from "./test-commercial-plan-fixtures";
import { layoutScenarioFixture } from "./test-layout-scenario-fixtures";
import {
  prepareStoreLayoutScenario,
  preparePhysicalAllocationDraft,
  buildCommercialWeekPlan,
} from "../packages/commercial-core/src/index";
import { testChoiceDigest } from "./test-commercial-choice-fixtures";
export async function physicalAllocationFixture() {
  const f = await commercialPlanFixture(),
    layout = await layoutScenarioFixture(f.storeId);
  layout.input.assignments[1]!.items = [{ kind: "OFFER", id: f.choice.id }];
  layout.sources.products = [f.product, layout.product];
  layout.sources.choices = [f.choice];
  const scenario = prepareStoreLayoutScenario(
    f.storeId,
    layout.input,
    layout.sources,
  ).scenario!;
  const linked = preparePhysicalAllocationDraft(scenario, f.preparation, {
      id: f.preparation.id,
      now: "2026-10-19T12:00:00.000Z",
    }),
    context = {
      ...f.context,
      preparation: linked,
      allocationSources: layout.sources,
    };
  const linkedPlan = await buildCommercialWeekPlan(
    {
      preparation: linked,
      version: 2,
      createdAt: f.plan.createdAt,
      validatedAt: linked.updatedAt,
    },
    context,
    testChoiceDigest,
  );
  return { ...f, layout, scenario, linked, context, linkedPlan };
}
