import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import {
  actionReviewFixture,
  actionReviewDatabase,
} from "../../../../scripts/test-action-review-fixtures";
import { decisionReadFixture } from "../../../../scripts/test-copilot-decision-fixtures";
import { readRecommendationDecisions } from "./decision-read-tool";
import {
  readActionReview,
  actionReviewResultSchema,
} from "./action-review-tool";
import { renderAnswerText } from "./answer-text";
import { readAnswerSource } from "../../../mobile/src/copilot/answer-source";
vi.mock("./decision-read-tool.js", () => ({
  readRecommendationDecisions: vi.fn(),
}));
const read = vi.mocked(readRecommendationDecisions),
  now = "2026-10-18T12:00:00.000Z";
beforeEach(() => read.mockReset());
async function fixture(
  type: "ACCEPT" | "MODIFY" | "POSTPONE" | "REJECT" = "ACCEPT",
) {
  const f = await actionReviewFixture(),
    { db, state } = actionReviewDatabase(f),
    choice = await decisionReadFixture(f.storeId, type);
  read.mockImplementation(async () => structuredClone(choice.context));
  return {
    ...f,
    db,
    state,
    ownerId: choice.ownerId,
    input: { ...f.input, decision: choice.decision },
    context: choice.context,
  };
}

it.each(["ACCEPT", "MODIFY", "POSTPONE", "REJECT"] as const)(
  "reviews the exact %s choice separately from declared execution and unchanged canonical numbers",
  async (type) => {
    const f = await fixture(type),
      before = structuredClone(f.state);
    const r = await readActionReview(f.db, f.storeId, f.input, now, f.ownerId);
    expect(r.status).toBe("READY");
    expect(r.decisionContext?.entries[0]?.latest.type).toBe(type);
    expect(r.decisionContext?.entries[0]?.latest.modifiedAction).toBe(
      type === "MODIFY" ? "Tester sur une TG plus petite." : null,
    );
    expect(r.task?.declaration).toEqual(f.task);
    expect(r.evidence[0]?.value).toContain("aucun lien durable");
    expect(r.evidence[0]?.value).toContain("après les périodes observées");
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(
      f.db,
      { storeId: f.storeId, ownerId: f.ownerId },
      f.context.input,
    );
    expect(
      r.duringComparison?.evidence.some(
        (e) => e.sourceType === "KPI" && e.value === "200",
      ),
    ).toBe(true);
    const citation = renderAnswerText(
      "Votre choix. {{source:0}}",
      [{ evidenceId: "decision-test" }],
      r.evidence,
    );
    expect(
      readAnswerSource(/copilot-source:([^)]*)/.exec(citation)![1]!).sourceId,
    ).toBe(f.input.decision.recommendationId);
    expect({ ...f.state, planReads: 0 }).toEqual(before);
  },
);
it.each(["MISSING", "CHANGED", "SOURCE_UNAVAILABLE"])(
  "stops before task/KPI reads when the selected decision is unsafe (%s)",
  async (mode) => {
    const f = await fixture();
    if (mode === "MISSING") {
      f.context.entries = [];
      f.context.evidence.shift();
    }
    if (mode === "CHANGED") f.input.decision.expectedVersion = 2;
    if (mode === "SOURCE_UNAVAILABLE")
      f.context.entries[0]!.sourceState = "UNAVAILABLE";
    const r = await readActionReview(f.db, f.storeId, f.input, now, f.ownerId);
    expect(r.status).toBe(
      mode === "MISSING"
        ? "DECISION_UNAVAILABLE"
        : mode === "CHANGED"
          ? "DECISION_CHANGED"
          : "DECISION_SOURCE_UNAVAILABLE",
    );
    expect(r.task).toBeNull();
    expect(r.duringComparison).toBeNull();
    expect(r.fieldEvents).toBeNull();
    expect(f.state.planReads).toBe(0);
  },
);
it.each([undefined, "not-an-id"])(
  "refuses unscoped private reads before touching Mongo (%s)",
  async (owner) => {
    const f = await fixture();
    await expect(
      readActionReview(f.db, f.storeId, f.input, now, owner),
    ).rejects.toThrow("FORBIDDEN");
    expect(read).not.toHaveBeenCalled();
    expect(f.state.planReads).toBe(0);
  },
);
it.each(["CHOICE", "VISIBILITY"])(
  "refuses a decision/source change during the review (%s)",
  async (mode) => {
    const f = await fixture(),
      changed = structuredClone(f.context);
    if (mode === "CHOICE") changed.entries[0]!.latest.reason = "Nouveau choix";
    else changed.entries[0]!.sourceState = "INACTIVE_SOURCE";
    read.mockResolvedValueOnce(f.context).mockResolvedValueOnce(changed);
    await expect(
      readActionReview(f.db, f.storeId, f.input, now, f.ownerId),
    ).rejects.toThrow("CHANGED");
  },
);
it.each([
  "REMOVED",
  "OTHER_ID",
  "VERSION",
  "STATUS",
  "EVIDENCE",
  "UNREQUESTED",
])("rejects a forged or detached contextual result (%s)", async (mode) => {
  const f = await fixture(),
    r = await readActionReview(f.db, f.storeId, f.input, now, f.ownerId);
  if (mode === "REMOVED") r.decisionContext = null;
  if (mode === "OTHER_ID") r.input.decision!.recommendationId = randomUUID();
  if (mode === "VERSION") r.input.decision!.expectedVersion = 2;
  if (mode === "STATUS") r.status = "DECISION_UNAVAILABLE";
  if (mode === "EVIDENCE") r.evidence.splice(1, 1);
  if (mode === "UNREQUESTED") delete r.input.decision;
  expect(actionReviewResultSchema.safeParse(r).success).toBe(false);
});

it("keeps an archived conversation usable as historical context without validating its recommendation", async () => {
  const f = await fixture();
  f.context.entries[0]!.sourceState = "INACTIVE_SOURCE";
  const r = await readActionReview(f.db, f.storeId, f.input, now, f.ownerId);
  expect(r.status).toBe("READY");
  expect(r.decisionContext?.entries[0]?.sourceState).toBe("INACTIVE_SOURCE");
  expect(r.evidence[0]?.value).toContain(
    "contexte du conseil n’est pas revalidé",
  );
});
