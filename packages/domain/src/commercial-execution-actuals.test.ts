import { it, expect } from "vitest";
import {
  commercialExecutionActualsSchema,
  commercialExecutionActualsNotFuture,
  executionActualsUpdate,
  legacyCommercialExecution,
  commercialExecutionActualsSummary,
} from "./commercial-execution-task";
import type { CommercialExecutionTask } from "./commercial-execution-task";
const actuals = {
  start: "2026-10-07",
  end: "2026-10-09",
  price: "1.89",
  priceUnit: "KG" as const,
  location: "TG entrée",
};
it.each([
  { start: "2026-02-30" },
  { start: null },
  { end: "2026-10-06" },
  { price: "1,89" },
  { price: "1.891" },
  { price: "1e2" },
  { price: "-1" },
  { price: "01.00" },
  { priceUnit: null },
  { price: null },
  { location: " " },
  { priceUnit: "UNKNOWN" },
])("rejects contradictory or noncanonical actual details %j", (patch) => {
  expect(
    commercialExecutionActualsSchema.safeParse({ ...actuals, ...patch })
      .success,
  ).toBe(false);
});
it("keeps unknown details null, zero price distinct from missing, and explicit removal distinct from omission", async () => {
  const base: CommercialExecutionTask = {
      id: "00000000-0000-4000-8000-000000000001",
      storeId: "00000000-0000-4000-8000-000000000002",
      planId: "00000000-0000-4000-8000-000000000003",
      planRevisionId: "00000000-0000-4000-8000-000000000004",
      planVersion: 1,
      planChecksum: "a".repeat(64),
      kind: "INSTALL_TG",
      targetId: "00000000-0000-4000-8000-000000000005",
      label: "TG entrée",
      status: "DONE",
      note: "",
      completedAt: "2026-10-11T12:00:00Z",
      version: 1,
      createdAt: "2026-10-11T12:00:00Z",
      updatedAt: "2026-10-11T12:00:00Z",
    },
    task = { ...base, actuals };
  expect(executionActualsUpdate(task, {})).toEqual({ actuals });
  expect(executionActualsUpdate(task, { actuals: null })).toEqual({
    actuals: null,
  });
  expect(executionActualsUpdate(base, {})).toEqual({});
  expect(
    commercialExecutionActualsSchema.parse({
      ...actuals,
      start: null,
      end: null,
      price: "0",
      location: null,
    }).price,
  ).toBe("0");
  expect(legacyCommercialExecution(task)).toEqual(base);
  expect(commercialExecutionActualsSummary(actuals)).toContain("1,89 € / kg");
  expect(commercialExecutionActualsSummary(null)).toContain("non renseignés");
});
it("checks actual dates in the store Paris calendar without deriving any from declaration time", () => {
  expect(
    commercialExecutionActualsNotFuture(
      { ...actuals, start: "2026-10-09", end: null },
      "2026-10-08T22:30:00Z",
    ),
  ).toBe(true);
  expect(
    commercialExecutionActualsNotFuture(actuals, "2026-10-08T12:00:00Z"),
  ).toBe(false);
  expect(
    commercialExecutionActualsNotFuture(null, "2026-10-08T12:00:00Z"),
  ).toBe(true);
  expect(
    commercialExecutionActualsSchema.safeParse({
      start: null,
      end: null,
      price: null,
      priceUnit: null,
      location: null,
    }).success,
  ).toBe(false);
});
