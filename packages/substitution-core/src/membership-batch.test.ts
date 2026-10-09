import { it, expect } from "vitest";
import { prepareNeedMembershipBatch } from "./index";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
] as const;
const hashes = new Map<string, string>();
const digest = async (s: string) => {
  if (!hashes.has(s))
    hashes.set(s, (hashes.size + 1).toString(16).padEnd(64, "0"));
  return hashes.get(s)!;
};
function input() {
  return {
    request: {
      storeId: ids[0],
      candidates: [
        {
          productId: ids[1],
          needUnitId: ids[3],
          strength: 0.9,
          confidence: 0.3,
          primary: false,
        },
        {
          productId: ids[1],
          needUnitId: ids[4],
          strength: 0.4,
          confidence: 0.8,
          primary: true,
        },
        {
          productId: ids[2],
          needUnitId: ids[3],
          strength: 0.2,
          confidence: 0.5,
          primary: false,
        },
      ],
    },
    products: [
      { id: ids[1], storeId: ids[0], status: "ACTIVE" },
      { id: ids[2], storeId: ids[0], status: "ACTIVE" },
    ],
    needs: [
      { id: ids[3], storeId: ids[0], status: "ACTIVE" },
      { id: ids[4], storeId: ids[0], status: "ACTIVE" },
    ],
    existing: [],
    actor: "USER" as const,
    decision: "VALIDATE" as const,
    humanConfirmed: true,
    now: "2026-10-09T08:00:00Z",
    digest,
  };
}
it("prepares overlapping many-to-many classifications without inventing confidence or substituting products", async () => {
  const r = await prepareNeedMembershipBatch(input());
  expect(r.prepared).toHaveLength(3);
  expect(new Set(r.prepared.map((m) => m.id)).size).toBe(3);
  expect(r.prepared[0]).toMatchObject({
    strength: 0.9,
    confidence: 0.3,
    source: "MANUAL",
    status: "VALIDATED",
  });
  const repeat = await prepareNeedMembershipBatch({
    ...input(),
    existing: r.prepared,
  });
  expect(repeat.prepared).toEqual([]);
  expect(repeat.skipped.every((s) => s.reason === "UNCHANGED")).toBe(true);
});
it("gives AI preparation-only authority and preserves human validated/rejected/manual proposal decisions", async () => {
  await expect(
    prepareNeedMembershipBatch({ ...input(), actor: "AI" }),
  ).rejects.toThrow("HUMAN_DECISION_REQUIRED");
  const p = await prepareNeedMembershipBatch({
    ...input(),
    actor: "AI",
    decision: "PROPOSE",
    humanConfirmed: false,
  });
  expect(
    p.prepared.every(
      (m) =>
        m.source === "AI_PROPOSED" &&
        m.status === "PROPOSED" &&
        !m.humanConfirmed,
    ),
  ).toBe(true);
  const confirmed = await prepareNeedMembershipBatch(input());
  const blocked = await prepareNeedMembershipBatch({
    ...input(),
    existing: confirmed.prepared.map((m) => ({
      ...m,
      status: "REJECTED" as const,
    })),
    actor: "AI",
    decision: "PROPOSE",
    humanConfirmed: false,
  });
  expect(blocked.prepared).toEqual([]);
  expect(blocked.skipped).toHaveLength(3);
});
it("refuses missing/foreign/inactive parents, duplicate targets and implicit missing numeric declarations", async () => {
  const f = input();
  await expect(prepareNeedMembershipBatch({ ...f, needs: [] })).rejects.toThrow(
    "PARENT_INVALID",
  );
  await expect(
    prepareNeedMembershipBatch({
      ...f,
      products: f.products.map((p) => ({ ...p, storeId: ids[4] })),
    }),
  ).rejects.toThrow("PARENT_INVALID");
  await expect(
    prepareNeedMembershipBatch({
      ...f,
      needs: f.needs.map((n) => ({ ...n, status: "INACTIVE" })),
    }),
  ).rejects.toThrow("PARENT_INACTIVE");
  await expect(
    prepareNeedMembershipBatch({
      ...f,
      request: {
        ...f.request,
        candidates: [f.request.candidates[0], f.request.candidates[0]],
      },
    }),
  ).rejects.toThrow("DUPLICATE_TARGET");
  await expect(
    prepareNeedMembershipBatch({
      ...f,
      request: {
        ...f.request,
        candidates: [{ productId: ids[1], needUnitId: ids[3], primary: false }],
      },
    }),
  ).rejects.toThrow();
});

it("does not let AI overwrite a human draft and requires explicit user confirmation to reactivate a rejection", async () => {
  const manual = await prepareNeedMembershipBatch({
    ...input(),
    decision: "PROPOSE",
    humanConfirmed: false,
  });
  const unchanged = await prepareNeedMembershipBatch({
    ...input(),
    existing: manual.prepared,
    actor: "AI",
    decision: "PROPOSE",
    humanConfirmed: false,
  });
  expect(unchanged.prepared).toEqual([]);
  const old = manual.prepared.map((m) => ({
    ...m,
    status: "REJECTED" as const,
    humanConfirmed: true,
  }));
  await expect(
    prepareNeedMembershipBatch({
      ...input(),
      existing: old,
      humanConfirmed: false,
    }),
  ).rejects.toThrow("HUMAN_DECISION_REQUIRED");
  const accepted = await prepareNeedMembershipBatch({
    ...input(),
    existing: old,
  });
  expect(
    accepted.prepared.every(
      (m) => m.humanConfirmed && m.status === "VALIDATED" && m.version === 2,
    ),
  ).toBe(true);
});
