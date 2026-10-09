import { randomUUID } from "node:crypto";
import { commercialPlanFixture } from "./test-commercial-plan-fixtures";
import { testChoiceDigest } from "./test-commercial-choice-fixtures";
import { commercialExecutionPlanChecksum } from "../packages/commercial-core/src/index";
import {
  reminderInstant,
  proposedReminderDate,
  type CommercialReminder,
} from "../packages/domain/src/index";
export async function reminderFixture() {
  const f = await commercialPlanFixture(),
    op = f.plan.operations[0]!,
    r: CommercialReminder = {
      id: randomUUID(),
      storeId: f.plan.storeId,
      planId: f.plan.id,
      planRevisionId: f.plan.revisionId,
      planChecksum: await commercialExecutionPlanChecksum(
        f.plan,
        testChoiceDigest,
      ),
      operationId: op.id,
      weekStart: f.plan.weekStart,
      deadlineDate: op.plannedStart,
      fireAt: reminderInstant(proposedReminderDate(op.plannedStart), "09:00"),
      enabled: true,
      version: 1,
      createdAt: f.plan.validatedAt,
      updatedAt: f.plan.validatedAt,
    };
  return { ...f, reminder: r };
}
