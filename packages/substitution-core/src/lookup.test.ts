import { it, expect } from "vitest";
import { evidenceFixture } from "./evidence-fixtures";
import { lookupSubstitutes } from "./lookup";
const idA = "11111111-1111-4111-8111-111111111111",
  idB = "22222222-2222-4222-8222-222222222222",
  idC = "33333333-3333-4333-8333-333333333333";
async function fixture() {
  const f = await evidenceFixture();
  return {
    f,
    input: {
      storeId: f.substitution.storeId,
      productId: f.product.id,
      at: f.input.now,
      products: [
        { entity: f.product, syncState: "SYNCED" },
        { entity: f.substitute, syncState: "SYNCED" },
      ],
      needs: [{ entity: f.need, syncState: "SYNCED" }],
      relations: [{ entity: f.substitution, syncState: "SYNCED" }],
      events: [],
    },
  };
}
it("finds only human-confirmed outgoing relations and never infers a reverse or transitive edge", async () => {
  const { f, input } = await fixture();
  const reverse = {
    ...f.substitution,
    id: idA,
    sourceProductId: f.substitute.id,
    substituteProductId: f.product.id,
  };
  const result = lookupSubstitutes({
    ...input,
    products: [
      ...input.products,
      { entity: { ...f.substitute, id: idC }, syncState: "SYNCED" },
    ],
    relations: [
      {
        entity: {
          ...f.substitution,
          id: idB,
          sourceProductId: f.substitute.id,
          substituteProductId: idC,
        },
        syncState: "SYNCED",
      },
      ...input.relations,
      { entity: reverse, syncState: "SYNCED" },
    ],
  });
  expect(result.candidates.map((c) => c.productId)).toEqual([f.substitute.id]);
  expect(
    lookupSubstitutes({ ...input, productId: f.substitute.id }).candidates,
  ).toEqual([]);
  expect(result.candidates[0]!.availability).toBe("UNKNOWN");
  expect(f.substitution.relationshipScore).toBeNull();
});
it("separates an unlearned declared ranking from canonical learned score and unknown confidence", async () => {
  const { input } = await fixture(),
    c = lookupSubstitutes(input).candidates[0]!;
  expect(c.basis).toBe("DECLARED");
  expect(c.fit).toBe(0.75);
  expect(c.relation.relationshipScore).toBeNull();
  expect(c.relation.confidence).toBeNull();
  const learned = {
    ...input.relations[0]!.entity,
    relationshipScore: 0,
    observedSubstitution: 0,
    confidence: 0,
    evidenceCount: 1,
    lastEvidenceAt: input.at,
    status: "LEARNING" as const,
  };
  const result = lookupSubstitutes({
    ...input,
    relations: [{ entity: learned, syncState: "SYNCED" }],
  });
  expect(result.candidates[0]).toMatchObject({ fit: 0, basis: "LEARNED" });
});
it("excludes rejection, proposal, unresolved sync and inactive/deleted/foreign parents without validating them", async () => {
  const { f, input } = await fixture();
  for (const syncState of ["CONFLICT", "ERROR", "UNKNOWN"])
    expect(
      lookupSubstitutes({
        ...input,
        relations: [{ entity: f.substitution, syncState }],
      }).excluded[0]!.reason,
    ).toBe("RELATION_SYNC_UNRESOLVED");
  for (const status of ["REJECTED", "PROPOSED"] as const)
    expect(
      lookupSubstitutes({
        ...input,
        relations: [
          {
            entity: {
              ...f.substitution,
              status,
              humanConfirmed: status === "REJECTED",
            },
            syncState: "SYNCED",
          },
        ],
      }).candidates,
    ).toEqual([]);
  for (const entity of [
    { ...f.substitute, status: "INACTIVE" },
    { ...f.substitute, deletedAt: input.at },
    { ...f.substitute, storeId: idA },
  ])
    expect(
      lookupSubstitutes({
        ...input,
        products: [input.products[0]!, { entity, syncState: "SYNCED" }],
      }).excluded[0]!.reason,
    ).toBe("PRODUCT_UNAVAILABLE");
  expect(
    lookupSubstitutes({
      ...input,
      needs: [
        { entity: { ...f.need, status: "TO_REVIEW" }, syncState: "SYNCED" },
      ],
    }).excluded[0]!.reason,
  ).toBe("NEED_UNAVAILABLE");
  expect(lookupSubstitutes({ ...input, products: [] }).status).toBe(
    "SOURCE_UNAVAILABLE",
  );
});
it("accepts a confirmed offline pending relation without requiring complete product taxonomy", async () => {
  const { input } = await fixture();
  const c = lookupSubstitutes({
    ...input,
    products: input.products.map((p) => ({
      ...p,
      syncState: "PENDING",
      entity: { ...p.entity, category: "UNKNOWN", salesUnit: "UNKNOWN" },
    })),
    relations: input.relations.map((r) => ({ ...r, syncState: "PENDING" })),
  }).candidates[0]!;
  expect(c.syncState).toBe("PENDING");
  expect(c.availability).toBe("UNKNOWN");
});
it("immediately excludes a local stockout but a closed/future/documentary/foreign event does not invent unavailability", async () => {
  const { f, input } = await fixture(),
    stockout = {
      ...f.event,
      id: idA,
      productId: f.substitute.id,
      status: "ACTIVE" as const,
      endedAt: null,
    };
  expect(
    lookupSubstitutes({
      ...input,
      events: [{ entity: stockout, syncState: "PENDING" }],
    }).excluded[0]!.reason,
  ).toBe("OUT_OF_STOCK");
  for (const entity of [
    f.event,
    { ...stockout, source: "COMMERCIAL_PDF" as const, sourceDocumentId: idB },
    { ...stockout, storeId: idC },
    {
      ...stockout,
      startedAt: "2026-10-11T10:00:00Z",
      clientCapturedAt: "2026-10-11T12:00:00Z",
    },
    { ...stockout, endedAt: "2026-10-09T22:00:00Z", status: "CLOSED" as const },
  ])
    expect(
      lookupSubstitutes({ ...input, events: [{ entity, syncState: "SYNCED" }] })
        .candidates,
    ).toHaveLength(1);
});
it("exposes known warnings while preserving unknown stock and excludes unresolved events", async () => {
  const { f, input } = await fixture(),
    event = {
      ...f.event,
      id: idA,
      productId: f.substitute.id,
      type: "QUALITY_ISSUE" as const,
      status: "ACTIVE" as const,
      endedAt: null,
    };
  const result = lookupSubstitutes({
    ...input,
    events: [{ entity: event, syncState: "PENDING" }],
  });
  expect(result.candidates[0]).toMatchObject({
    availability: "UNKNOWN",
    events: [{ id: idA, type: "QUALITY_ISSUE" }],
  });
  expect(
    lookupSubstitutes({
      ...input,
      events: [{ entity: event, syncState: "CONFLICT" }],
    }).excluded[0]!.reason,
  ).toBe("EVENT_UNRESOLVED");
});
it("groups one candidate across needs, supports a specific need and stays stable under input permutation", async () => {
  const { f, input } = await fixture(),
    need = { ...f.need, id: idA },
    relation = {
      ...f.substitution,
      id: idB,
      needUnitId: need.id,
      needCompatibility: 1,
      usageCompatibility: 1,
    };
  const multiple = {
    ...input,
    needs: [...input.needs, { entity: need, syncState: "SYNCED" }],
    relations: [...input.relations, { entity: relation, syncState: "SYNCED" }],
  };
  const result = lookupSubstitutes(multiple);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]!.relationships).toHaveLength(2);
  expect(result.candidates[0]!.relation.id).toBe(idB);
  expect(
    lookupSubstitutes({
      ...multiple,
      relations: [...multiple.relations].reverse(),
    }),
  ).toEqual(result);
  expect(
    lookupSubstitutes({ ...multiple, needUnitId: f.need.id }).candidates[0]!
      .relationships,
  ).toHaveLength(1);
});
it("orders by behavioural fit, never margin; confidence only breaks equal-fit ties and null remains distinct from zero", async () => {
  const { f, input } = await fixture(),
    product = { ...f.substitute, id: idA, marginValue: "999999" },
    weaker = {
      ...f.substitution,
      id: idB,
      substituteProductId: idA,
      needCompatibility: 0.1,
      usageCompatibility: 0.2,
    };
  const more = {
    ...input,
    products: [...input.products, { entity: product, syncState: "SYNCED" }],
    relations: [{ entity: weaker, syncState: "SYNCED" }, ...input.relations],
  };
  expect(lookupSubstitutes(more).candidates.map((c) => c.productId)).toEqual([
    f.substitute.id,
    idA,
  ]);
  const known = {
    ...weaker,
    needCompatibility: 0.8,
    usageCompatibility: 0.7,
    confidence: 0,
    evidenceCount: 1,
  };
  expect(
    lookupSubstitutes({
      ...more,
      relations: [{ entity: known, syncState: "SYNCED" }, ...input.relations],
    }).candidates[0]!.productId,
  ).toBe(idA);
  const zero = lookupSubstitutes({
    ...input,
    relations: [
      {
        entity: { ...f.substitution, priceCompatibility: 0 },
        syncState: "SYNCED",
      },
    ],
  }).candidates[0]!.fit;
  expect(zero).toBeLessThan(lookupSubstitutes(input).candidates[0]!.fit);
});
it("does not return another store's relationships or mistake an unknown stock for zero", async () => {
  const { f, input } = await fixture();
  const result = lookupSubstitutes({
    ...input,
    relations: [
      { entity: { ...f.substitution, storeId: idA }, syncState: "SYNCED" },
    ],
  });
  expect(result.candidates).toEqual([]);
  expect(result.excluded).toEqual([]);
  expect(() => lookupSubstitutes({ ...input, at: "bad-date" })).toThrow();
});
