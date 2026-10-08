import { randomUUID } from "node:crypto";
import { testChoiceDigest } from "./test-commercial-choice-fixtures";
import { makeCommercialPlanFixture } from "./commercial-plan-fixture-data";
export function commercialPlanFixture() {
  return makeCommercialPlanFixture(testChoiceDigest, randomUUID);
}
