import { it, expect } from "vitest";
import { makeCommercialPlanFixture } from "../../../scripts/commercial-plan-fixture-data";
import {
  buildCommercialWeekPlan,
  commercialPlanNeedsReview,
  commercialPlanIssues,
} from "./week-plan";
import { commercialWeekPlanSchema } from "@fl-copilot/domain";
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const digest = async (s: string) => {
  let hash = 2166136261;
  for (const c of s) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0").repeat(8);
};
const fixture = () => makeCommercialPlanFixture(digest, uuid);
it("materializes exact validated terms, stable IDs and planned-only operations without altering draft/source/choice data", async () => {
  const f = await fixture(),
    before = JSON.stringify(f.context);
  expect(f.plan.offers[0]?.customerMechanism).toEqual(f.choice.mechanism);
  expect(f.plan.operations[0]).toMatchObject({
    planningStatus: "PLANNED",
    actualStart: null,
    actualEnd: null,
    plannedStart: "2026-10-08",
  });
  expect(f.plan.preparation.status).toBe("DRAFT");
  expect(
    await buildCommercialWeekPlan(
      {
        preparation: f.preparation,
        version: 1,
        createdAt: f.plan.createdAt,
        validatedAt: f.plan.validatedAt,
      },
      f.context,
      digest,
    ),
  ).toEqual(f.plan);
  expect(JSON.stringify(f.context)).toBe(before);
  expect(
    commercialWeekPlanSchema.safeParse({ ...f.plan, status: "IN_EXECUTION" })
      .success,
  ).toBe(false);
});
it("groups exact same source operation/period only, preserves plural literal natures and is independent of selection order", async () => {
  const f = await fixture();
  const second = {
    ...f.choice,
    id: uuid(),
    productId: uuid(),
    rawProductLabel: "Autre produit",
    source: { ...f.choice.source, itemIndex: 1 },
  };
  const reading = JSON.parse(JSON.stringify(f.reading)) as typeof f.reading;
  reading.reading!.operations[0]!.items.push({
    ...reading.reading!.operations[0]!.items[0]!,
    label: second.rawProductLabel,
  });
  const v = {
    ...f.validated,
    id: await import("./offer-validation").then((m) =>
      m.commercialValidatedOfferId(f.storeId, second.id, 1, digest),
    ),
    choice: second,
  };
  v.sourceFields = [
    ...v.sourceFields,
    {
      name: "operationNature",
      rawValue: "PROSPECTUS / DRAMATIZATION",
      confidence: 1,
      evidence: [],
    },
  ];
  const prep = {
      ...f.preparation,
      offerRefs: [
        ...f.preparation.offerRefs,
        { choiceId: second.id, choiceVersion: 1 },
      ],
    },
    ctx = {
      ...f.context,
      preparation: prep,
      choices: [...f.context.choices, second],
      validated: [...f.context.validated, v],
      products: [
        ...f.context.products,
        { id: second.productId, label: second.rawProductLabel, version: 1 },
      ],
      pages: [reading],
    };
  const p = await buildCommercialWeekPlan(
    {
      preparation: prep,
      version: 1,
      createdAt: f.plan.createdAt,
      validatedAt: f.plan.validatedAt,
    },
    ctx,
    digest,
  );
  expect(p.operations).toHaveLength(1);
  expect(p.operations[0]?.operationNature).toEqual([
    "DRAMATIZATION",
    "PROSPECTUS",
  ]);
  expect(p.operations[0]?.offerIds).toHaveLength(2);
  const reversed = { ...prep, offerRefs: [...prep.offerRefs].reverse() };
  const other = await buildCommercialWeekPlan(
    {
      preparation: reversed,
      version: 1,
      createdAt: f.plan.createdAt,
      validatedAt: f.plan.validatedAt,
    },
    {
      ...ctx,
      preparation: reversed,
      choices: [...ctx.choices].reverse(),
      validated: [...ctx.validated].reverse(),
    },
    digest,
  );
  expect(other.operations).toEqual(p.operations);
  expect(other.offers).toEqual(p.offers);
});
it("rejects stale/withdrawn/unvalidated selections, missing source/product and empty TGs", async () => {
  const f = await fixture();
  for (const ctx of [
    { ...f.context, validated: [] },
    { ...f.context, products: [] },
    { ...f.context, pages: [] },
    { ...f.context, choices: [{ ...f.choice, version: 2 }] },
    { ...f.context, choices: [{ ...f.choice, status: "WITHDRAWN" as const }] },
  ])
    await expect(
      buildCommercialWeekPlan(
        {
          preparation: f.preparation,
          version: 1,
          createdAt: f.plan.createdAt,
          validatedAt: f.plan.validatedAt,
        },
        ctx,
        digest,
      ),
    ).rejects.toThrow("COMMERCIAL_PLAN_");
  const p = {
    ...f.preparation,
    placements: f.preparation.placements.map((t) => ({ ...t, offerIds: [] })),
  };
  expect(
    commercialPlanIssues(p, { ...f.context, preparation: p })[0]?.code,
  ).toBe("EMPTY_TG");
});
it("requires review after draft/product/reference changes and retains original price snapshots", async () => {
  const f = await fixture();
  expect(commercialPlanNeedsReview(f.plan, f.context)).toEqual([]);
  expect(
    commercialPlanNeedsReview(f.plan, {
      ...f.context,
      preparation: { ...f.preparation, note: "changed", version: 2 },
    }).some((i) => i.code === "PREPARATION_CHANGED"),
  ).toBe(true);
  expect(
    commercialPlanNeedsReview(f.plan, {
      ...f.context,
      products: f.context.products.map((p) => ({ ...p, version: 2 })),
    }).some((i) => i.code === "PRODUCT_CHANGED"),
  ).toBe(true);
  expect(f.plan.offers[0]?.customerMechanism).toEqual(f.choice.mechanism);
  const later = await buildCommercialWeekPlan(
    {
      preparation: f.preparation,
      version: 2,
      createdAt: f.plan.createdAt,
      validatedAt: "2026-10-08T13:00:00.000Z",
    },
    f.context,
    digest,
  );
  expect(later.id).toBe(f.plan.id);
  expect(later.revisionId).not.toBe(f.plan.revisionId);
  expect(later.offers[0]?.id).toBe(f.plan.offers[0]?.id);
});
