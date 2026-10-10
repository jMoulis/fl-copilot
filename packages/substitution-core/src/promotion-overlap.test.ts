import { it, expect } from "vitest";
import { makePromotionPairFixture } from "../../../scripts/promotion-overlap-fixture-data";
import { detectPromotionOverlaps } from "./promotion-overlap";
import type { NeedMembership, ProductSubstitution } from "@fl-copilot/domain";
let sequence = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const digest = async (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};
async function fixture() {
  const f = await makePromotionPairFixture(digest, uuid),
    need = { id: uuid(), storeId: f.storeId, status: "ACTIVE" },
    membership: NeedMembership = {
      id: uuid(),
      storeId: f.storeId,
      productId: f.product.id,
      needUnitId: need.id,
      strength: 0.8,
      confidence: 0.6,
      primary: false,
      source: "MANUAL",
      status: "VALIDATED",
      humanConfirmed: true,
      version: 1,
      createdAt: f.plan.createdAt,
      updatedAt: f.plan.updatedAt,
    },
    other = { ...membership, id: uuid(), productId: f.candidate.id },
    relation: ProductSubstitution = {
      id: uuid(),
      storeId: f.storeId,
      sourceProductId: f.product.id,
      substituteProductId: f.candidate.id,
      needUnitId: need.id,
      needCompatibility: 0.8,
      usageCompatibility: 0.7,
      priceCompatibility: null,
      packagingCompatibility: null,
      observedSubstitution: null,
      relationshipScore: null,
      confidence: null,
      evidenceCount: 0,
      lastEvidenceAt: null,
      status: "VALIDATED",
      source: "MANUAL",
      humanConfirmed: true,
      version: 1,
      createdAt: f.plan.createdAt,
      updatedAt: f.plan.updatedAt,
    };
  return {
    ...f,
    need,
    membership,
    other,
    relation,
    input: {
      storeId: f.storeId,
      plan: f.plan,
      products: [
        { entity: f.product, syncState: "SYNCED" },
        { entity: f.candidate, syncState: "SYNCED" },
      ],
      needs: [{ entity: need, syncState: "SYNCED" }],
      memberships: [
        { entity: membership, syncState: "SYNCED" },
        { entity: other, syncState: "SYNCED" },
      ],
      relations: [] as Array<{
        entity: ProductSubstitution;
        syncState: string;
      }>,
    },
  };
}
it("warns about intersecting planned dates and a confirmed strong shared need, retaining both mechanisms without causal figures", async () => {
  const f = await fixture(),
    before = JSON.stringify(f.input),
    result = detectPromotionOverlaps(f.input),
    w = result.warnings[0]!;
  expect(result.warnings).toHaveLength(1);
  expect(w.support[0]!.kind).toBe("SHARED_NEED");
  expect(w.start).toBe("2026-10-08");
  expect(w.end).toBe("2026-10-10");
  expect(
    new Set([w.first.customerMechanism.type, w.second.customerMechanism.type]),
  ).toEqual(new Set(["PRICE_CEILING", "LOT"]));
  expect(w.impact).toEqual({
    salesTransfer: null,
    lostSales: null,
    marginImpact: null,
  });
  expect(w.interpretation).toBe("POTENTIAL_COMMERCIAL_OVERLAP");
  expect(JSON.stringify(f.input)).toBe(before);
  expect(f.plan.operations.every((o) => o.actualStart === null)).toBe(true);
});
it("uses the explicit directed relation without requiring or inventing a reverse edge", async () => {
  const f = await fixture(),
    input = {
      ...f.input,
      memberships: [],
      relations: [{ entity: f.relation, syncState: "PENDING" }],
    };
  const w = detectPromotionOverlaps(input).warnings[0]!;
  expect(w.support).toMatchObject([
    {
      kind: "DIRECTED_SUBSTITUTION",
      relationshipId: f.relation.id,
      sourceProductId: f.product.id,
      substituteProductId: f.candidate.id,
      fit: 0.75,
      basis: "DECLARED",
      confidence: null,
    },
  ]);
  expect(input.relations).toHaveLength(1);
  expect(
    detectPromotionOverlaps({
      ...input,
      plan: { ...f.plan, offers: [...f.plan.offers].reverse() },
    }),
  ).toEqual(detectPromotionOverlaps(input));
});
it("returns one pair even if shared need and both explicit directions provide separate support", async () => {
  const f = await fixture(),
    reverse = {
      ...f.relation,
      id: uuid(),
      sourceProductId: f.candidate.id,
      substituteProductId: f.product.id,
    };
  const w = detectPromotionOverlaps({
    ...f.input,
    relations: [
      { entity: f.relation, syncState: "SYNCED" },
      { entity: reverse, syncState: "SYNCED" },
    ],
  }).warnings;
  expect(w).toHaveLength(1);
  expect(w[0]!.support).toHaveLength(3);
});
it("does not use weak, unconfirmed, rejected or unresolved membership/relationship data", async () => {
  const f = await fixture();
  for (const entity of [
    { ...f.membership, strength: 0.2 },
    { ...f.membership, status: "PROPOSED" as const, humanConfirmed: false },
    { ...f.membership, status: "REJECTED" as const },
  ])
    expect(
      detectPromotionOverlaps({
        ...f.input,
        memberships: [{ entity, syncState: "SYNCED" }, f.input.memberships[1]!],
      }).warnings,
    ).toEqual([]);
  for (const entity of [
    { ...f.relation, needCompatibility: 0.1, usageCompatibility: 0.2 },
    { ...f.relation, status: "REJECTED" as const },
    { ...f.relation, status: "PROPOSED" as const, humanConfirmed: false },
  ])
    expect(
      detectPromotionOverlaps({
        ...f.input,
        memberships: [],
        relations: [{ entity, syncState: "SYNCED" }],
      }).warnings,
    ).toEqual([]);
  for (const syncState of ["ERROR", "CONFLICT"])
    expect(
      detectPromotionOverlaps({
        ...f.input,
        memberships: [],
        relations: [{ entity: f.relation, syncState }],
      }).warnings,
    ).toEqual([]);
});
it("preserves independent shared-need support without relabeling a rejected directed relation", async () => {
  const f = await fixture(),
    r = { ...f.relation, status: "REJECTED" as const };
  const w = detectPromotionOverlaps({
    ...f.input,
    relations: [{ entity: r, syncState: "SYNCED" }],
  }).warnings[0]!;
  expect(w.support.map((s) => s.kind)).toEqual(["SHARED_NEED"]);
  expect(r.status).toBe("REJECTED");
});
it("keeps an actual learned zero distinct from an absent score and refuses missing/inactive/foreign parents", async () => {
  const f = await fixture(),
    r = {
      ...f.relation,
      status: "LEARNING" as const,
      relationshipScore: 0,
      confidence: 0,
      observedSubstitution: 0,
      evidenceCount: 1,
      lastEvidenceAt: f.plan.updatedAt,
    };
  expect(
    detectPromotionOverlaps({
      ...f.input,
      memberships: [],
      relations: [{ entity: r, syncState: "SYNCED" }],
    }).warnings,
  ).toEqual([]);
  for (const entity of [
    { ...f.candidate, status: "INACTIVE" },
    { ...f.candidate, deletedAt: f.plan.updatedAt },
    { ...f.candidate, storeId: uuid() },
  ])
    expect(
      detectPromotionOverlaps({
        ...f.input,
        products: [f.input.products[0]!, { entity, syncState: "SYNCED" }],
      }).warnings,
    ).toEqual([]);
  expect(
    detectPromotionOverlaps({
      ...f.input,
      needs: [
        { entity: { ...f.need, status: "INACTIVE" }, syncState: "SYNCED" },
      ],
    }).warnings,
  ).toEqual([]);
  expect(() =>
    detectPromotionOverlaps({ ...f.input, storeId: uuid() }),
  ).toThrow("STORE_INVALID");
});
it("clips remaining dates, skips completed or disjoint periods and keeps same-day boundaries inclusive", async () => {
  const f = await fixture();
  expect(
    detectPromotionOverlaps({ ...f.input, fromDate: "2026-10-10" }).warnings[0],
  ).toMatchObject({ start: "2026-10-10", end: "2026-10-10" });
  expect(
    detectPromotionOverlaps({ ...f.input, fromDate: "2026-10-11" }).warnings,
  ).toEqual([]);
  const plan = JSON.parse(JSON.stringify(f.plan)) as typeof f.plan;
  const second = plan.offers.find((o) => o.productId === f.candidate.id)!,
    op = plan.operations.find((o) => o.id === second.operationId)!;
  second.saleStart = "2026-10-11";
  second.saleEnd = "2026-10-11";
  op.plannedStart = second.saleStart;
  op.plannedEnd = second.saleEnd;
  expect(detectPromotionOverlaps({ ...f.input, plan }).warnings).toEqual([]);
  second.saleStart = "2026-10-10";
  op.plannedStart = second.saleStart;
  expect(
    detectPromotionOverlaps({ ...f.input, plan }).warnings[0],
  ).toMatchObject({ start: "2026-10-10", end: "2026-10-10" });
});
it("does not infer transitive substitutes or fabricate complementarity from unrelated/weak records", async () => {
  const f = await fixture();
  expect(
    detectPromotionOverlaps({ ...f.input, memberships: [], relations: [] })
      .warnings,
  ).toEqual([]);
  const third = uuid(),
    r1 = { ...f.relation, substituteProductId: third },
    r2 = { ...f.relation, id: uuid(), sourceProductId: third };
  expect(
    detectPromotionOverlaps({
      ...f.input,
      memberships: [],
      relations: [
        { entity: r1, syncState: "SYNCED" },
        { entity: r2, syncState: "SYNCED" },
      ],
    }).warnings,
  ).toEqual([]);
});
