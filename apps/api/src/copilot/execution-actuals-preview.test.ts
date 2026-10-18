import { it, expect } from "vitest";
import {
  actionReviewFixture,
  actionReviewDatabase,
} from "../../../../scripts/test-action-review-fixtures";
import { readCommercialExecutionPreview } from "./commercial-plan-tool";
const actuals = {
  start: "2026-10-08",
  end: "2026-10-09",
  price: "1.89",
  priceUnit: "KG" as const,
  location: "TG entrée",
};
it("prepares actual details without writes or inherited plan values and detects an identical declaration", async () => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f),
    input = {
      weekStart: f.plan.weekStart,
      taskId: f.task.id,
      status: f.task.status,
      note: f.task.note,
      actuals,
    };
  const p = await readCommercialExecutionPreview(db, f.storeId, input, true);
  expect(p.status).toBe("READY");
  expect(p.input.actuals).toEqual(actuals);
  expect(state.tasks[0]).not.toHaveProperty("actuals");
  Object.assign(state.tasks[0]!, { actuals });
  const locationOnly = await readCommercialExecutionPreview(
    db,
    f.storeId,
    { ...input, actuals: { location: "TG fond" } },
    true,
  );
  expect(locationOnly.status).toBe("READY");
  expect(locationOnly.preview?.before?.actuals).toEqual(actuals);
  expect(
    (await readCommercialExecutionPreview(db, f.storeId, input, true)).status,
  ).toBe("UNCHANGED");
  expect(
    (
      await readCommercialExecutionPreview(
        db,
        f.storeId,
        { ...input, actuals: null },
        true,
      )
    ).status,
  ).toBe("READY");
});
it("does not offer actual fields to legacy cards and rejects future or unsupported requested actuals", async () => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f),
    input = {
      weekStart: f.plan.weekStart,
      taskId: f.task.id,
      status: f.task.status,
      note: f.task.note,
    };
  Object.assign(state.tasks[0]!, { actuals });
  const legacy = await readCommercialExecutionPreview(db, f.storeId, input);
  expect(legacy.status).toBe("UNCHANGED");
  expect(legacy.preview?.before).not.toHaveProperty("actuals");
  await expect(
    readCommercialExecutionPreview(db, f.storeId, { ...input, actuals }),
  ).rejects.toThrow("UNSUPPORTED");
  await expect(
    readCommercialExecutionPreview(
      db,
      f.storeId,
      { ...input, actuals: { ...actuals, start: "2099-01-01", end: null } },
      true,
    ),
  ).rejects.toThrow("ACTUALS_INVALID");
});
