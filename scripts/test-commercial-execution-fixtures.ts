import { commercialPlanFixture } from "./test-commercial-plan-fixtures";
import { testChoiceDigest } from "./test-commercial-choice-fixtures";
import { commercialExecutionChecklist } from "../packages/commercial-core/src/index";
import type { CommercialExecutionTask } from "../packages/domain/src/index";
export async function commercialExecutionFixture() {
  const f = await commercialPlanFixture(),
    proposals = await commercialExecutionChecklist(f.plan, testChoiceDigest);
  const task: CommercialExecutionTask = {
    ...proposals[0]!,
    status: "DONE",
    note: "Affiche préparée",
    completedAt: f.plan.validatedAt,
    version: 1,
    createdAt: f.plan.validatedAt,
    updatedAt: f.plan.validatedAt,
  };
  return { ...f, proposals, task };
}
