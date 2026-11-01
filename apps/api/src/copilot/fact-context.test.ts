import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { factContextFixture } from "../../../../scripts/test-fact-context-fixtures";
import { saveDecision } from "../../../../scripts/test-copilot-decision-fixtures";
import {
  appendFactContext,
  readRecommendationContext,
  readTrackingWithFactContext,
  factDigest,
  factReadFromTool,
} from "./fact-context";
import {
  recommendationContextResultSchema,
  factReadSchema,
} from "@fl-copilot/domain";
import { buildRecommendationTrackingMessages } from "./recommendation-tracking-messages";
const devices: Array<{ close(): void }> = [];
afterEach(() => {
  for (const d of devices.splice(0)) d.close();
});
async function fixture() {
  const f = await factContextFixture();
  devices.push(f.n.db.db);
  return f;
}
const now = "2026-10-19T08:00:00.000Z";
it("replays the original metric order rather than a sorted cache key and keeps unchanged scoped reads distinct from eligibility", async () => {
  const f = await fixture(),
    r = await readRecommendationContext(f.db, f.scope, f.contextInput, now);
  expect(r.status).toBe("UNCHANGED");
  expect(r.checkedCount).toBe(2);
  expect(f.trace.reads[0]!.read).toMatchObject({
    kind: "PERIOD",
    input: { metrics: ["waste", "sales"] },
  });
  expect(r.evidence[0]?.value).toContain("ni éligibilité opérationnelle");
});
it("marks changed figures stale and suppresses a new tracking card without deleting an offline choice or realization", async () => {
  const f = await fixture();
  await saveDecision(f.n, "ACCEPT");
  const before = await f.n.db.getAllAsync("SELECT * FROM copilot_decisions");
  const actions = await f.n.db.getAllAsync("SELECT * FROM action_executions");
  f.state.performances[1]!.performance.sales.salesValue = "201";
  const r = await readRecommendationContext(f.db, f.scope, f.contextInput, now);
  expect(r).toMatchObject({ status: "STALE", changed: ["PERIOD"] });
  expect(r.evidence[0]?.label).toBe("À recalculer");
  const preview = await readTrackingWithFactContext(
    f.db,
    f.scope,
    f.contextInput,
  );
  expect(preview.status).toBe("STALE");
  expect(buildRecommendationTrackingMessages(f.n.assistant, [preview])).toEqual(
    [],
  );
  expect(await f.n.db.getAllAsync("SELECT * FROM copilot_decisions")).toEqual(
    before,
  );
  expect(await f.n.db.getAllAsync("SELECT * FROM action_executions")).toEqual(
    actions,
  );
});
it.each(["LEGACY", "INCOMPLETE", "UNAVAILABLE"])(
  "does not default to current when verification is incomplete (%s)",
  async (mode) => {
    const f = await fixture();
    if (mode === "LEGACY") delete f.records[f.source.id];
    if (mode === "INCOMPLETE")
      (f.records[f.source.id] as { complete: boolean }).complete = false;
    if (mode === "UNAVAILABLE") f.control.failMetrics = true;
    const r = await readRecommendationContext(
      f.db,
      f.scope,
      f.contextInput,
      now,
    );
    expect(r.status).toBe("UNVERIFIABLE");
    expect(r.unavailableCount).toBe(mode === "UNAVAILABLE" ? 1 : 0);
    if (mode !== "UNAVAILABLE")
      expect(
        (await readTrackingWithFactContext(f.db, f.scope, f.contextInput))
          .status,
      ).toBe("READY");
  },
);
it.each(["OWNER", "STORE", "ARCHIVED", "HIDDEN", "QUOTE"])(
  "does not read private provenance for an unavailable source (%s)",
  async (mode) => {
    const f = await fixture(),
      scope = { ...f.scope },
      input = { ...f.contextInput };
    if (mode === "OWNER") scope.ownerId = randomUUID();
    if (mode === "STORE") scope.storeId = randomUUID();
    if (mode === "ARCHIVED") f.topic.status = "ARCHIVED";
    if (mode === "HIDDEN")
      Object.assign(f.topic, { deletedMessageIds: [f.source.id] });
    if (mode === "QUOTE") input.quote = "Une autre suggestion";
    const r = await readRecommendationContext(f.db, scope, input, now);
    expect(r).toMatchObject({
      status: "SOURCE_UNAVAILABLE",
      checkedCount: 0,
      unavailableCount: 0,
    });
    expect(r.changed).toEqual([]);
  },
);
it("rejects scope/source drift and a source hidden during replay", async () => {
  const f = await fixture();
  (f.records[f.source.id] as { sourceDigest: string }).sourceDigest =
    "0".repeat(64);
  await expect(
    readRecommendationContext(f.db, f.scope, f.contextInput, now),
  ).rejects.toThrow("COPILOT_FACT_CONTEXT_SCOPE_INVALID");
  (f.records[f.source.id] as { sourceDigest: string }).sourceDigest = (
    await import("./recommendation-tracking-tool")
  ).recommendationSourceDigest(f.n.source);
  f.control.hideOnMetrics = true;
  await expect(
    readRecommendationContext(f.db, f.scope, f.contextInput, now),
  ).rejects.toThrow("COPILOT_FACT_CONTEXT_CHANGED");
});
it("keeps provenance immutable and refuses nontransactional/unowned-parent writes", async () => {
  const f = await fixture();
  await appendFactContext(f.db, f.session, f.n.source, f.trace, [], false);
  await expect(
    appendFactContext(
      f.db,
      f.session,
      f.n.source,
      { ...f.trace, complete: false },
      [],
      false,
    ),
  ).rejects.toThrow("IDENTITY_CONFLICT");
  await expect(
    appendFactContext(
      f.db,
      { inTransaction: () => false } as ClientSession,
      f.n.source,
      f.trace,
      [],
      false,
    ),
  ).rejects.toThrow("TRANSACTION_REQUIRED");
  await expect(
    appendFactContext(
      f.db,
      f.session,
      { ...f.n.source, id: randomUUID() },
      f.trace,
      [],
      false,
    ),
  ).rejects.toThrow("SOURCE_INVALID");
});
it("uses deterministic object fingerprints, rejects arbitrary reads and preserves unsupported coverage", () => {
  expect(factDigest({ b: 2, a: { z: 1, y: 0 } })).toBe(
    factDigest({ a: { y: 0, z: 1 }, b: 2 }),
  );
  expect(
    factReadFromTool(JSON.stringify(["public-research", {}]), {}),
  ).toBeNull();
  expect(
    factReadSchema.safeParse({ kind: "MONGO", input: { query: {} } }).success,
  ).toBe(false);
});
it("rejects impossible result coverage", async () => {
  const f = await fixture(),
    r = await readRecommendationContext(f.db, f.scope, f.contextInput, now);
  for (const bad of [
    { ...r, status: "STALE" },
    { ...r, checkedCount: 0 },
    { ...r, changed: ["PERIOD", "PERIOD"] },
    { ...r, unavailableCount: 5 },
  ])
    expect(recommendationContextResultSchema.safeParse(bad).success).toBe(
      false,
    );
});

it("retains the resolved ISO period in new fact snapshots without rewriting historical civil reads", () => {
  const input = {
    productId: null,
    currentPeriod: { start: "2026-10-01", end: "2026-10-30" },
    referencePeriod: { start: "2025-10-01", end: "2025-10-30" },
    aggregation: "SUM",
    metrics: ["sales"],
  };
  const referencePeriod = { start: "2025-10-02", end: "2025-10-31" };
  const snapshot = factReadFromTool(JSON.stringify(["period", input]), {
    currentPeriod: input.currentPeriod,
    referencePeriod,
    coverage: [{ metric: "sales" }],
  });
  expect(snapshot?.read).toMatchObject({
    kind: "PERIOD",
    input: { referencePeriod },
  });
  expect(factReadSchema.parse({ kind: "PERIOD", input }).input).toMatchObject({
    referencePeriod: input.referencePeriod,
  });
});
