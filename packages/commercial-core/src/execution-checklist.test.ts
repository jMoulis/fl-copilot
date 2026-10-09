import { it, expect } from "vitest";
import { makeCommercialPlanFixture } from "../../../scripts/commercial-plan-fixture-data";
import {
  commercialExecutionChecklist,
  commercialExecutionProgress,
} from "./execution-checklist";
import { buildCommercialWeekPlan } from "./week-plan";
import { commercialExecutionTaskSchema } from "@fl-copilot/domain";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  digest = async (s: string) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return h.toString(16).padStart(8, "0").repeat(8);
  };
it("proposes useful tasks without creating completion or altering the plan/official prices", async () => {
  const f = await makeCommercialPlanFixture(digest, uuid),
    before = JSON.stringify(f.plan),
    p = await commercialExecutionChecklist(f.plan, digest);
  expect(p.map((t) => t.kind)).toEqual(["PRINT_SIGNAGE", "INSTALL_TG"]);
  expect(await commercialExecutionChecklist(f.plan, digest)).toEqual(p);
  expect(commercialExecutionProgress(p, [])).toEqual({
    total: 2,
    TODO: 2,
    DONE: 0,
    SKIPPED: 0,
    NOT_APPLICABLE: 0,
  });
  const done = {
    ...p[0]!,
    status: "DONE" as const,
    note: "",
    completedAt: f.plan.validatedAt,
    version: 1,
    createdAt: f.plan.validatedAt,
    updatedAt: f.plan.validatedAt,
  };
  expect(commercialExecutionProgress(p, [done]).DONE).toBe(1);
  expect(commercialExecutionProgress(p, [done]).TODO).toBe(1);
  expect(JSON.stringify(f.plan)).toBe(before);
});
it("requires an explanation for ignored/nonapplicable tasks and consistent completion timestamps", async () => {
  const f = await makeCommercialPlanFixture(digest, uuid),
    [p] = await commercialExecutionChecklist(f.plan, digest),
    base = {
      ...p!,
      status: "TODO",
      note: "",
      completedAt: null,
      version: 1,
      createdAt: f.plan.validatedAt,
      updatedAt: f.plan.validatedAt,
    };
  expect(commercialExecutionTaskSchema.safeParse(base).success).toBe(true);
  expect(
    commercialExecutionTaskSchema.safeParse({ ...base, status: "DONE" })
      .success,
  ).toBe(false);
  expect(
    commercialExecutionTaskSchema.safeParse({ ...base, status: "SKIPPED" })
      .success,
  ).toBe(false);
  expect(
    commercialExecutionTaskSchema.safeParse({
      ...base,
      status: "NOT_APPLICABLE",
      note: "Pas de TG disponible",
    }).success,
  ).toBe(true);
});
it("never carries completion to another revision or a different copy of the same plan revision", async () => {
  const f = await makeCommercialPlanFixture(digest, uuid),
    first = await commercialExecutionChecklist(f.plan, digest),
    p = await buildCommercialWeekPlan(
      {
        preparation: f.preparation,
        version: 2,
        createdAt: f.plan.createdAt,
        validatedAt: "2026-10-09T12:00:00.000Z",
      },
      f.context,
      digest,
    ),
    next = await commercialExecutionChecklist(p, digest);
  expect(next[0]?.id).not.toBe(first[0]?.id);
  const copy = await buildCommercialWeekPlan(
    {
      preparation: f.preparation,
      version: 1,
      createdAt: f.plan.createdAt,
      validatedAt: "2026-10-09T12:00:00.000Z",
    },
    f.context,
    digest,
  );
  expect(
    (await commercialExecutionChecklist(copy, digest))[0]?.planChecksum,
  ).not.toBe(first[0]?.planChecksum);
});
