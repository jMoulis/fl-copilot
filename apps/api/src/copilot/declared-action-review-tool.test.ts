import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { declaredActionReviewInputSchema } from "@fl-copilot/domain";
import { declaredActionReviewFixture } from "../../../../scripts/test-declared-action-review-fixtures";
import {
  readDeclaredActionReview,
  declaredActionReviewResultSchema,
} from "./declared-action-review-tool";
import { renderAnswerText } from "./answer-text";
import { readAnswerSource } from "../../../mobile/src/copilot/answer-source";
const now = "2026-10-18T12:01:00.000Z";
const devices: Array<{ close(): void }> = [];
afterEach(() => {
  for (const d of devices.splice(0)) d.close();
});
async function fixture() {
  const f = await declaredActionReviewFixture();
  devices.push(f.n.db.db);
  return f;
}
it("reviews a private offline-confirmed realization without a plan or acceptance, using canonical metrics and source links", async () => {
  const f = await fixture();
  const r = await readDeclaredActionReview(f.db, f.scope, f.input, now);
  expect(r.status).toBe("READY");
  expect(r.declaration).toEqual(f.declaration);
  expect(r.duringComparison?.coverage[0]?.current).toMatchObject({
    expectedDays: 2,
    partialDays: 1,
    missingDays: 1,
  });
  expect(r.afterComparison?.wasteRates?.[0]?.wasteTotal).toBeNull();
  expect(r.duringComparison?.wasteRates?.[0]?.wasteTotal).toBe("0");
  expect(r.evidence[0]?.value).toContain("ni causalité");
  expect(r.evidence[0]?.value).toContain("aucune association");
  expect(r.evidence[0]?.value).toContain("journée en cours");
  expect(
    f.state.reads.every((n) =>
      [
        "actionExecutions",
        "products",
        "productDailyPerformance",
        "storeProductEvents",
      ].includes(n),
    ),
  ).toBe(true);
  expect(await f.n.db.getAllAsync("SELECT * FROM copilot_decisions")).toEqual(
    [],
  );
  const numeric = r.evidence.find(
    (e) => e.sourceType === "KPI" && e.value === "200",
  )!;
  const text = renderAnswerText(
    "Le CA renseigné est partiel. {{source:0}}",
    [{ evidenceId: numeric.id }],
    r.evidence,
  );
  expect(readAnswerSource(/copilot-source:([^)]*)/.exec(text)![1]!).value).toBe(
    "200",
  );
});
it.each(["OWNER", "STORE", "ABSENT", "CHANGED", "WITHDRAWN"])(
  "blocks unsafe declarations before reading metrics (%s)",
  async (mode) => {
    const f = await fixture(),
      scope = { ...f.scope };
    if (mode === "OWNER") scope.ownerId = randomUUID();
    if (mode === "STORE") scope.storeId = randomUUID();
    if (mode === "ABSENT") f.state.declaration = null;
    if (mode === "CHANGED" || mode === "WITHDRAWN")
      f.state.declaration = {
        ...f.declaration,
        status: "WITHDRAWN",
        version: 2,
        withdrawnAt: now,
      };
    const r = await readDeclaredActionReview(
      f.db,
      scope,
      { ...f.input, expectedVersion: mode === "WITHDRAWN" ? 2 : 1 },
      now,
    );
    expect(r.status).toBe(
      mode === "CHANGED"
        ? "EXECUTION_CHANGED"
        : mode === "WITHDRAWN"
          ? "EXECUTION_WITHDRAWN"
          : "EXECUTION_UNAVAILABLE",
    );
    expect(r.duringComparison).toBeNull();
    expect(f.state.metricReads).toBe(0);
    if (mode === "OWNER" || mode === "STORE")
      expect(JSON.stringify(r)).not.toContain(f.declaration.snapshot.action);
  },
);
it.each(["changeDeclaration", "changeReference"] as const)(
  "refuses a concurrent change (%s)",
  async (key) => {
    const f = await fixture();
    f.state[key] = true;
    await expect(
      readDeclaredActionReview(f.db, f.scope, f.input, now),
    ).rejects.toThrow("COPILOT_ACTION_REVIEW_CHANGED");
  },
);
it("does not infer an after period and warns when review windows exceed real dates", async () => {
  const f = await fixture();
  f.state.declaration!.snapshot.actuals!.end = "2026-10-16";
  const r = await readDeclaredActionReview(
    f.db,
    f.scope,
    { ...f.input, after: null },
    now,
  );
  expect(r.afterComparison).toBeNull();
  expect(f.state.metricReads).toBe(1);
  expect(r.evidence[0]?.value).toContain("Période après non demandée");
  expect(r.evidence[0]?.value).toContain("déborde les dates réelles");
});
it("rejects future windows before accessing private data or any KPI", async () => {
  const f = await fixture();
  await expect(
    readDeclaredActionReview(
      f.db,
      f.scope,
      { ...f.input, after: { start: "2026-10-19", end: "2026-10-19" } },
      now,
    ),
  ).rejects.toThrow("COPILOT_ACTION_REVIEW_FUTURE");
  expect(f.state.reads).toEqual([]);
});
it("binds returned figures, events, declaration and sources to the requested review", async () => {
  const f = await fixture(),
    r = await readDeclaredActionReview(f.db, f.scope, f.input, now);
  for (const bad of [
    { ...r, input: { ...r.input, executionId: randomUUID() } },
    {
      ...r,
      duringComparison: {
        ...r.duringComparison!,
        target: { ...r.duringComparison!.target, productId: randomUUID() },
      },
    },
    { ...r, fieldEvents: { ...r.fieldEvents!, productId: randomUUID() } },
    { ...r, evidence: r.evidence.slice(0, 1) },
    { ...r, status: "EXECUTION_UNAVAILABLE" },
  ])
    expect(declaredActionReviewResultSchema.safeParse(bad).success).toBe(false);
});
it.each(["DUPLICATE", "OVERLAP", "SPAN", "WINDOW", "UNKNOWN"])(
  "bounds explicit review input (%s)",
  async (mode) => {
    const f = await fixture();
    const i = structuredClone(f.input);
    if (mode === "DUPLICATE") i.metrics = ["sales", "sales"];
    if (mode === "OVERLAP") i.during.start = i.before.end;
    if (mode === "SPAN") i.before = { start: "2026-01-01", end: "2026-01-02" };
    if (mode === "WINDOW")
      i.before = { start: "2026-09-01", end: "2026-10-13" };
    expect(
      declaredActionReviewInputSchema.safeParse(
        mode === "UNKNOWN" ? { ...i, mongo: {} } : i,
      ).success,
    ).toBe(false);
  },
);
