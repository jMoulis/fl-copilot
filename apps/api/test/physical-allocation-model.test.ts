import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import {
  commercialWeekPreparationSchema,
  legacyPhysicalEntity,
  legacyPhysicalPreparation,
  legacyPhysicalPlan,
} from "@fl-copilot/domain";
import {
  preparePhysicalAllocationDraft,
  assertPhysicalAllocationCurrent,
  commercialPlanIssues,
  commercialPlanNeedsReview,
  buildCommercialWeekPlan,
} from "@fl-copilot/commercial-core";
import { physicalAllocationFixture } from "../../../scripts/test-physical-allocation-fixtures";
import { testChoiceDigest } from "../../../scripts/test-commercial-choice-fixtures";
it("keeps the exact scenario and full existing preparation, without converting assortment products to promotional offers or changing TGs", async () => {
  const f = await physicalAllocationFixture();
  expect(f.linked.physicalAllocation).toEqual(f.scenario);
  expect(f.linked.version).toBe(f.preparation.version + 1);
  for (const key of [
    "id",
    "storeId",
    "weekStart",
    "weekEnd",
    "placements",
    "note",
    "tgCapacity",
    "createdAt",
    "offerRefs",
  ] as const)
    expect(f.linked[key]).toEqual(f.preparation[key]);
  const fresh = preparePhysicalAllocationDraft(f.scenario, null, {
    id: randomUUID(),
    now: f.linked.updatedAt,
  });
  expect(fresh.offerRefs).toEqual([
    { choiceId: f.choice.id, choiceVersion: f.choice.version },
  ]);
  expect(fresh.placements).toEqual([]);
  expect(fresh.tgCapacity).toBeNull();
});
it("requires exact store/week/offer versions and never silently refreshes a selected offer", async () => {
  const f = await physicalAllocationFixture(),
    old = {
      ...f.preparation,
      offerRefs: [{ choiceId: f.choice.id, choiceVersion: 2 }],
    };
  expect(() =>
    preparePhysicalAllocationDraft(f.scenario, old, {
      id: old.id,
      now: old.updatedAt,
    }),
  ).toThrow("REFRESH_REQUIRED");
  for (const physicalAllocation of [
    { ...f.scenario, storeId: randomUUID() },
    { ...f.scenario, weekStart: "2026-10-12" },
  ])
    expect(
      commercialWeekPreparationSchema.safeParse({
        ...f.linked,
        physicalAllocation,
      }).success,
    ).toBe(false);
  expect(
    commercialWeekPreparationSchema.safeParse({ ...f.linked, offerRefs: [] })
      .success,
  ).toBe(false);
});
it("carries the allocation unchanged into the validated commercial revision, and blocks missing/changed physical sources", async () => {
  const f = await physicalAllocationFixture();
  expect(commercialPlanIssues(f.linked, f.context)).toEqual([]);
  expect(f.linkedPlan.preparation.physicalAllocation).toEqual(f.scenario);
  const unavailable = { ...f.context, allocationSources: undefined };
  expect(commercialPlanNeedsReview(f.linkedPlan, unavailable)).toContainEqual(
    expect.objectContaining({ code: "PHYSICAL_ALLOCATION_REVIEW_REQUIRED" }),
  );
  const changed = structuredClone(f.layout.sources);
  changed.products[0]!.version++;
  expect(() =>
    assertPhysicalAllocationCurrent(f.storeId, f.scenario, changed),
  ).toThrow("SOURCES_CHANGED");
  await expect(
    buildCommercialWeekPlan(
      {
        preparation: f.linked,
        version: 3,
        createdAt: f.plan.createdAt,
        validatedAt: f.linked.updatedAt,
      },
      { ...f.context, allocationSources: changed },
      testChoiceDigest,
    ),
  ).rejects.toThrow();
});
it("downgrades only the optional allocation at every wire level, preserving the canonical source and approval", async () => {
  const f = await physicalAllocationFixture(),
    before = JSON.stringify(f.linkedPlan);
  expect(legacyPhysicalPreparation(f.linked)).not.toHaveProperty(
    "physicalAllocation",
  );
  expect(legacyPhysicalPlan(f.linkedPlan).preparation).not.toHaveProperty(
    "physicalAllocation",
  );
  const r = {
    id: f.linkedPlan.revisionId,
    storeId: f.storeId,
    plan: f.linkedPlan,
    version: 1 as const,
  };
  expect(
    legacyPhysicalEntity("commercial_week_plan_revision", r).plan.preparation,
  ).not.toHaveProperty("physicalAllocation");
  expect(JSON.stringify(f.linkedPlan)).toBe(before);
  expect(legacyPhysicalPlan(f.linkedPlan).status).toBe("VALIDATED");
});
