import { expect, it } from "vitest";
import {
  commercialProcessingFixture,
  processingTime,
} from "../../../../scripts/test-commercial-processing-fixtures";
import {
  commercialProcessingPolicy,
  type ProcessingPage,
} from "./processing-recovery-policy";
import { COMMERCIAL_AI_RUNTIME_BUDGET_VERSION } from "./ai-runtime-limits";
const now = processingTime;
const past = new Date(now.getTime() - 1000),
  future = new Date(now.getTime() + 60_000);
it("offers only unfinished stages and does not mutate the frozen source or retained results", () => {
  const s = commercialProcessingFixture();
  s.aiPages = [
    {
      _id: "received",
      pageNumber: 1,
      checksum: s.source.checksum,
      status: "DRAFT_READY",
      hasResult: true,
      attemptCount: 3,
    },
  ];
  const before = structuredClone(s),
    r = commercialProcessingPolicy(s, now);
  expect(r).toMatchObject({
    state: "PARTIAL",
    canResume: true,
    eligible: ["AI", "VISUAL"],
  });
  expect(r.stages[1]).toMatchObject({ readyPages: 1, totalPages: 2 });
  expect(s).toEqual(before);
});
it.each(["PENDING", "PROCESSING", "FAILED"])(
  "preserves text retry/lease/permanent failure semantics (%s)",
  (status) => {
    const s = commercialProcessingFixture();
    Object.assign(s.job!, {
      stage: "TEXT_EXTRACTION",
      status,
      leaseExpiresAt: past,
    });
    expect(commercialProcessingPolicy(s, now).eligible).toEqual(
      status === "FAILED" ? [] : ["TEXT"],
    );
    s.job!.leaseExpiresAt = future;
    s.job!.nextAttemptAt = future;
    expect(commercialProcessingPolicy(s, now).canResume).toBe(false);
  },
);
it.each(["AI", "VISUAL"] as const)(
  "does not resume while another %s worker holds a live lease",
  (kind) => {
    const s = commercialProcessingFixture();
    const row = {
      _id: "active",
      pageNumber: 1,
      checksum: s.source.checksum,
      status: "PROCESSING",
      leaseExpiresAt: future,
      attemptCount: 1,
      runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
      budgetAttemptCount: 1,
    };
    (kind === "AI" ? s.aiPages : s.visualPages).push(row);
    expect(commercialProcessingPolicy(s, now)).toMatchObject({
      canResume: false,
      state: "RUNNING",
      eligible: [],
    });
    row.leaseExpiresAt = past;
    expect(commercialProcessingPolicy(s, now).eligible).toContain(kind);
  },
);
it.each([
  "legacy budget",
  "missing budget",
  "lost result",
  "partial result",
  "wrong checksum",
  "duplicate page",
])("blocks unsafe AI replay even when a second page is missing: %s", (why) => {
  const s = commercialProcessingFixture();
  const row: ProcessingPage = {
    _id: "page",
    pageNumber: 1,
    checksum: s.source.checksum,
    status: "RETRY",
    attemptCount: 1,
    runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
    budgetAttemptCount: 1,
  };
  if (why === "legacy budget") row.runtimeBudgetVersion = 1;
  if (why === "missing budget") delete row.budgetAttemptCount;
  if (why === "lost result") row.status = "DRAFT_READY";
  if (why === "partial result") row.hasResult = true;
  if (why === "wrong checksum") row.checksum = `sha256:${"c".repeat(64)}`;
  s.aiPages = [row];
  if (why === "duplicate page") s.aiPages.push({ ...row, _id: "duplicate" });
  const r = commercialProcessingPolicy(s, now);
  expect(r.eligible).not.toContain("AI");
  expect(r.stages[1]!.state).toBe("BLOCKED");
});
it("respects due times and cooldown without hiding accepted work from the worker", () => {
  const s = commercialProcessingFixture();
  s.job!.nextAiAttemptAt = future;
  expect(commercialProcessingPolicy(s, now).eligible).toEqual(["VISUAL"]);
  s.job!.lastManualResumeAt = now;
  expect(commercialProcessingPolicy(s, now)).toMatchObject({
    canResume: false,
    eligible: ["VISUAL"],
  });
  expect(
    commercialProcessingPolicy(s, new Date(now.getTime() + 300_001)).canResume,
  ).toBe(true);
});
it("never retries current exhausted or permanently failed AI pages", () => {
  const s = commercialProcessingFixture();
  s.aiPages = [1, 2].map((pageNumber) => ({
    _id: `${pageNumber}`,
    pageNumber,
    checksum: s.source.checksum,
    status: pageNumber === 1 ? "FAILED" : "RETRY",
    attemptCount: 4,
    budgetAttemptCount: 4,
    runtimeBudgetVersion: COMMERCIAL_AI_RUNTIME_BUDGET_VERSION,
  }));
  expect(commercialProcessingPolicy(s, now).eligible).not.toContain("AI");
  expect(commercialProcessingPolicy(s, now).stages[1]!.state).toBe("BLOCKED");
});
it("does not announce receipt when completed markers have no result", () => {
  const s = commercialProcessingFixture();
  s.aiPages = [1, 2].map((pageNumber) => ({
    _id: `${pageNumber}`,
    pageNumber,
    checksum: s.source.checksum,
    status: "DRAFT_READY",
    hasResult: false,
  }));
  expect(commercialProcessingPolicy(s, now).stages[1]).toMatchObject({
    state: "BLOCKED",
    readyPages: 0,
  });
});
it.each(["disabled", "identity", "text missing", "page limit"])(
  "fails closed for unavailable proof: %s",
  (why) => {
    const s = commercialProcessingFixture();
    if (why === "disabled") s.enabled = false;
    if (why === "identity") s.job!.objectKey = "other.pdf";
    if (why === "text missing") s.textPages.pop();
    if (why === "page limit") s.job!.pageCount = 101;
    expect(commercialProcessingPolicy(s, now)).toMatchObject({
      state: "UNAVAILABLE",
      canResume: false,
      eligible: [],
    });
  },
);
it("keeps received results readable without restarting an analysis after a model change", () => {
  const s = commercialProcessingFixture();
  s.job!.aiModel = "old-model";
  expect(commercialProcessingPolicy(s, now).eligible).not.toContain("AI");
});

it("finalizes fully received pages without rerunning providers and never resumes an unknown visual state", () => {
  const s = commercialProcessingFixture();
  s.aiPages = [1, 2].map((pageNumber) => ({
    _id: `ai-${pageNumber}`,
    pageNumber,
    checksum: s.source.checksum,
    status: "DRAFT_READY",
    hasResult: true,
  }));
  s.visualPages = [1, 2].map((pageNumber) => ({
    _id: `visual-${pageNumber}`,
    pageNumber,
    checksum: s.source.checksum,
    status: "READY",
    hasResult: true,
  }));
  expect(commercialProcessingPolicy(s, now)).toMatchObject({
    state: "READY",
    canResume: true,
    eligible: ["AI", "VISUAL"],
  });
  s.visualPages[0]!.status = "PENDING";
  s.visualPages[0]!.hasResult = false;
  expect(commercialProcessingPolicy(s, now).eligible).not.toContain("VISUAL");
});
