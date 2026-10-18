import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { copilotActionReviewInputSchema } from "@fl-copilot/domain";
import {
  actionReviewFixture,
  actionReviewDatabase,
  actionReviewPerformance,
} from "../../../../scripts/test-action-review-fixtures";
import {
  readActionReview,
  actionReviewResultSchema,
} from "./action-review-tool";
import { renderAnswerText } from "./answer-text";
import { readAnswerSource } from "../../../mobile/src/copilot/answer-source";
const now = "2026-10-18T12:00:00.000Z";
it("binds the current TG declaration to canonical before/during/after facts, partial coverage and source links without a write", async () => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f);
  const before = JSON.stringify(state);
  const r = await readActionReview(db, f.storeId, f.input, now);
  expect(r.status).toBe("READY");
  expect(r.task).toEqual({
    proposal: f.proposals.find((t) => t.id === f.input.taskId),
    declaration: f.task,
  });
  expect(r.duringComparison?.coverage[0]).toMatchObject({
    current: { expectedDays: 3, partialDays: 1, missingDays: 2 },
    reference: { expectedDays: 7, availableDays: 1, missingDays: 6 },
  });
  expect(r.afterComparison?.currentPeriod).toEqual(f.input.after);
  expect(r.duringComparison?.wasteRates?.[0]).toMatchObject({
    status: "PARTIAL",
    wasteTotal: "0",
    percentage: "0.00",
  });
  expect(r.afterComparison?.wasteRates?.[0]?.wasteTotal).toBeNull();
  expect(r.evidence[0]?.value).toContain("ne démontre ni causalité");
  expect(r.evidence[0]?.value).toContain("Durées et jours de semaine");
  const numeric = r.evidence.find(
    (e) => e.sourceType === "KPI" && e.value === "200",
  )!;
  expect(numeric).toBeDefined();
  const text = renderAnswerText(
    "Le CA renseigné est partiel. {{source:0}}",
    [{ evidenceId: numeric.id }],
    r.evidence,
  );
  expect(readAnswerSource(/copilot-source:([^)]*)/.exec(text)![1]!).value).toBe(
    "200",
  );
  expect({ ...state, planReads: 0 }).toEqual(JSON.parse(before));
});
it.each(["ABSENT", "TODO", "SKIPPED", "NOT_APPLICABLE"])(
  "keeps undeclared or unperformed execution separate from observed numbers (%s)",
  async (mode) => {
    const f = await actionReviewFixture(),
      { db, state } = actionReviewDatabase(f);
    if (mode === "ABSENT") state.tasks = [];
    else
      Object.assign(state.tasks[0]!, {
        status: mode,
        completedAt: null,
        note: mode === "TODO" ? "" : "Motif déclaré",
      });
    const r = await readActionReview(
      db,
      f.storeId,
      { ...f.input, after: null },
      now,
    );
    expect(r.status).toBe("READY");
    expect(r.afterComparison).toBeNull();
    expect(r.evidence[0]?.value).toContain(
      mode === "ABSENT"
        ? "réalisation inconnue"
        : `Déclaration utilisateur : ${mode}`,
    );
    expect(r.evidence[0]?.value).toContain("Période après non demandée");
  },
);
it.each([
  "NO_PLAN",
  "TASK_UNAVAILABLE",
  "PRODUCT_NOT_IN_TASK",
  "PERIOD_OUTSIDE_OFFER",
  "LIMIT_EXCEEDED",
  "DRIFTED",
])("does not load sampled KPI data for an unsafe target (%s)", async (mode) => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f),
    input = structuredClone(f.input);
  if (mode === "NO_PLAN") state.plan = null;
  if (mode === "TASK_UNAVAILABLE") input.taskId = randomUUID();
  if (mode === "PRODUCT_NOT_IN_TASK") input.productId = randomUUID();
  if (mode === "PERIOD_OUTSIDE_OFFER") {
    input.during.end = "2026-10-11";
    input.after.start = "2026-10-12";
  }
  if (mode === "LIMIT_EXCEEDED")
    state.tasks = Array.from({ length: 131 }, () => ({
      ...state.tasks[0]!,
      id: randomUUID(),
    })).map((t) => ({ ...t, _id: t.id }));
  if (mode === "DRIFTED") state.tasks[0]!.label = "Ancienne cible";
  const r = await readActionReview(db, f.storeId, input, now);
  expect(r.status).toBe(mode === "DRIFTED" ? "TASK_UNAVAILABLE" : mode);
  expect(r.duringComparison).toBeNull();
  expect(r.fieldEvents).toBeNull();
  expect(r.evidence).toHaveLength(1);
});
it.each(["PLAN", "REFERENCE"])(
  "refuses a concurrent change instead of mixing snapshots (%s)",
  async (mode) => {
    const f = await actionReviewFixture(),
      { db, state } = actionReviewDatabase(f);
    state.changePlan = mode === "PLAN";
    state.changeReference = mode === "REFERENCE";
    await expect(readActionReview(db, f.storeId, f.input, now)).rejects.toThrow(
      "CHANGED",
    );
  },
);
it.each([
  "OVERLAP",
  "INVERTED",
  "LONG",
  "SPAN",
  "DUPLICATE_METRIC",
  "AUTHORITY",
])("rejects invalid or authority-bearing requests (%s)", async (mode) => {
  const f = await actionReviewFixture(),
    input: Record<string, unknown> = structuredClone(f.input);
  if (mode === "OVERLAP")
    input.before = { start: "2026-10-01", end: "2026-10-08" };
  if (mode === "INVERTED")
    input.during = { start: "2026-10-10", end: "2026-10-08" };
  if (mode === "LONG")
    input.before = { start: "2026-08-01", end: "2026-10-07" };
  if (mode === "SPAN")
    input.before = { start: "2026-01-01", end: "2026-01-07" };
  if (mode === "DUPLICATE_METRIC") input.metrics = ["sales", "sales"];
  if (mode === "AUTHORITY") input.storeId = f.storeId;
  expect(copilotActionReviewInputSchema.safeParse(input).success).toBe(false);
});
it("rejects future windows before querying the database", async () => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f);
  await expect(
    readActionReview(db, f.storeId, f.input, "2026-10-12T20:00:00.000Z"),
  ).rejects.toThrow("FUTURE");
  expect(state.planReads).toBe(0);
});
it.each([
  "INPUT",
  "PRODUCT",
  "PERIOD",
  "DECLARATION",
  "EVENTS",
  "EVIDENCE",
  "STATUS",
])("rejects inconsistent returned data (%s)", async (mode) => {
  const f = await actionReviewFixture(),
    { db } = actionReviewDatabase(f),
    r = await readActionReview(db, f.storeId, f.input, now);
  if (mode === "INPUT") r.input.taskId = randomUUID();
  if (mode === "PRODUCT") r.duringComparison!.target.productId = randomUUID();
  if (mode === "PERIOD") r.afterComparison!.currentPeriod.start = "2026-10-12";
  if (mode === "DECLARATION")
    r.task!.declaration!.planChecksum = "0".repeat(64);
  if (mode === "EVENTS") r.fieldEvents!.startAt = "2026-10-01T00:00:00.000Z";
  if (mode === "EVIDENCE") r.evidence[1]!.value = "invented";
  if (mode === "STATUS") r.status = "NO_PLAN";
  expect(actionReviewResultSchema.safeParse(r).success).toBe(false);
});

it("compares unequal complete windows with canonical daily averages instead of an invented uplift", async () => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f);
  state.performances = [];
  for (const [p, value] of [
    [f.input.before, "100"],
    [f.input.during, "200"],
    [f.input.after, "150"],
  ] as const) {
    for (let d = Date.parse(p.start); d <= Date.parse(p.end); d += 86400000)
      state.performances.push(
        actionReviewPerformance(
          f.storeId,
          f.product.id,
          new Date(d).toISOString().slice(0, 10),
          value,
          null,
        ),
      );
  }
  const r = await readActionReview(
    db,
    f.storeId,
    { ...f.input, aggregation: "AVERAGE", metrics: ["sales"] },
    now,
  );
  expect(r.duringComparison?.coverage[0]?.comparisonStatus).toBe("AVAILABLE");
  expect(
    r.duringComparison?.evidence.find(
      (e) => JSON.parse(e.id).at(-1) === "percentage",
    )?.value,
  ).toBe("100.00");
  expect(
    r.afterComparison?.evidence.find(
      (e) => JSON.parse(e.id).at(-1) === "percentage",
    )?.value,
  ).toBe("50.00");
  expect(r.evidence[0]?.value).toContain("gain incrémental");
});
it("keeps signage printing separate from TG installation, even for the same product", async () => {
  const f = await actionReviewFixture(),
    { db } = actionReviewDatabase(f),
    task = f.proposals.find((t) => t.kind === "PRINT_SIGNAGE")!;
  const r = await readActionReview(
    db,
    f.storeId,
    { ...f.input, taskId: task.id, after: null },
    now,
  );
  expect(r.status).toBe("READY");
  expect(r.task?.proposal.kind).toBe("PRINT_SIGNAGE");
  expect(r.task?.declaration).toBeNull();
  expect(r.evidence[0]?.value).toContain(
    "Une affiche imprimée n’est pas une TG installée",
  );
});

it("quotes actual details separately and warns of mismatched exposure without changing selected periods or canonical amounts", async () => {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f);
  Object.assign(state.tasks[0]!, {
    actuals: {
      start: f.input.during.end,
      end: f.input.during.end,
      price: "0.99",
      priceUnit: "KG",
      location: "TG entrée",
    },
  });
  const result = await readActionReview(db, f.storeId, f.input, now);
  expect(result.status).toBe("READY");
  expect(result.duringComparison?.currentPeriod).toEqual(f.input.during);
  expect(result.evidence[0]?.value).toContain("0,99 € / kg");
  expect(result.evidence[0]?.value).toContain("déborde les dates réelles");
  expect(
    result.evidence.some((e) => e.sourceType === "KPI" && e.value === "200"),
  ).toBe(true);
});
