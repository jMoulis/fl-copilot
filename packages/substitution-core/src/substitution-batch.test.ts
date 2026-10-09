import { it, expect } from "vitest";
import {
  productSubstitutionId,
  productSubstitutionSchema,
} from "@fl-copilot/domain";
const hashes = new Map<string, string>();
const substitutionDigest = async (s: string) => {
  if (!hashes.has(s))
    hashes.set(s, (hashes.size + 1).toString(16).padEnd(64, "0"));
  return hashes.get(s)!;
};
async function substitutionFixture() {
  const storeId = "11111111-1111-4111-8111-111111111111",
    product = {
      id: "22222222-2222-4222-8222-222222222222",
      storeId,
      status: "ACTIVE",
    },
    substitute = { ...product, id: "33333333-3333-4333-8333-333333333333" },
    need = { ...product, id: "44444444-4444-4444-8444-444444444444" };
  return {
    product,
    substitute,
    need,
    substitution: {
      storeId,
      sourceProductId: product.id,
      substituteProductId: substitute.id,
      needUnitId: need.id,
      needCompatibility: 0.8,
      usageCompatibility: 0.7,
      createdAt: "2026-10-09T10:00:00Z",
    },
  };
}
import { prepareProductSubstitutionBatch } from "./index";
async function input() {
  const f = await substitutionFixture();
  const e = f.substitution;
  return {
    request: {
      storeId: e.storeId,
      candidates: [
        {
          sourceProductId: e.sourceProductId,
          substituteProductId: e.substituteProductId,
          needUnitId: e.needUnitId,
          needCompatibility: e.needCompatibility,
          usageCompatibility: e.usageCompatibility,
          priceCompatibility: null,
          packagingCompatibility: null,
        },
      ],
    },
    products: [f.product, f.substitute],
    needs: [f.need],
    existing: [],
    actor: "USER" as "USER" | "AI",
    decision: "VALIDATE" as "PROPOSE" | "VALIDATE" | "REJECT",
    humanConfirmed: true,
    now: e.createdAt,
    digest: substitutionDigest,
  };
}
it("keeps A to B, B to A and each need independently identified without fabricating scores", async () => {
  const i = await input();
  const r = await prepareProductSubstitutionBatch(i);
  const e = r.prepared[0]!;
  expect(e.relationshipScore).toBeNull();
  expect(e.confidence).toBeNull();
  expect(e.evidenceCount).toBe(0);
  const reverse = await productSubstitutionId(
    e.storeId,
    e.substituteProductId,
    e.sourceProductId,
    e.needUnitId,
    substitutionDigest,
  );
  expect(reverse).not.toBe(e.id);
  expect(r.prepared).toHaveLength(1);
  expect(
    await productSubstitutionId(
      e.storeId,
      e.sourceProductId,
      e.substituteProductId,
      e.needUnitId,
      substitutionDigest,
    ),
  ).toBe(e.id);
});
it("rejects self edges, duplicate targets, foreign parents and implicit confirmations", async () => {
  const i = await input(),
    c = i.request.candidates[0]!;
  await expect(
    prepareProductSubstitutionBatch({
      ...i,
      request: { ...i.request, candidates: [c, c] },
    }),
  ).rejects.toThrow("DUPLICATE_TARGET");
  await expect(
    prepareProductSubstitutionBatch({
      ...i,
      request: {
        ...i.request,
        candidates: [{ ...c, substituteProductId: c.sourceProductId }],
      },
    }),
  ).rejects.toThrow();
  await expect(
    prepareProductSubstitutionBatch({ ...i, humanConfirmed: false }),
  ).rejects.toThrow("HUMAN_DECISION");
  await expect(
    prepareProductSubstitutionBatch({
      ...i,
      products: [
        i.products[0]!,
        { ...i.products[1]!, storeId: i.needs[0]!.id },
      ],
    }),
  ).rejects.toThrow("PARENT_INVALID");
});
it("AI only proposes and never revives a rejected relationship or changes a human draft", async () => {
  const i = await input(),
    e = (await prepareProductSubstitutionBatch(i)).prepared[0]!;
  const ai = {
    ...i,
    actor: "AI" as const,
    decision: "PROPOSE" as const,
    humanConfirmed: false,
  };
  expect((await prepareProductSubstitutionBatch(ai)).prepared[0]).toMatchObject(
    { source: "AI_PROPOSED", status: "PROPOSED", humanConfirmed: false },
  );
  for (const status of ["VALIDATED", "REJECTED", "PROPOSED"] as const) {
    const r = await prepareProductSubstitutionBatch({
      ...ai,
      existing: [{ ...e, status }],
    });
    expect(r.prepared).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("HUMAN_DECISION_PRESERVED");
  }
  await expect(
    prepareProductSubstitutionBatch({ ...ai, decision: "VALIDATE" }),
  ).rejects.toThrow();
});
it("preserves trusted learned metrics through explicit user rejection and rejects model supplied scores", async () => {
  const i = await input(),
    e = (await prepareProductSubstitutionBatch(i)).prepared[0]!;
  const learned = {
    ...e,
    status: "LEARNING" as const,
    observedSubstitution: 0.4,
    relationshipScore: 0.7,
    confidence: 0.2,
    evidenceCount: 3,
    lastEvidenceAt: i.now,
  };
  const r = await prepareProductSubstitutionBatch({
    ...i,
    existing: [learned],
    decision: "REJECT",
  });
  expect(r.prepared[0]).toMatchObject({
    status: "REJECTED",
    relationshipScore: 0.7,
    confidence: 0.2,
    evidenceCount: 3,
  });
  await expect(
    prepareProductSubstitutionBatch({
      ...i,
      request: {
        ...i.request,
        candidates: [{ ...i.request.candidates[0], relationshipScore: 1 }],
      },
    }),
  ).rejects.toThrow();
  expect(
    productSubstitutionSchema.safeParse({
      ...e,
      evidenceCount: 0,
      relationshipScore: 1,
    }).success,
  ).toBe(false);
});
