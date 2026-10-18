import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { decisionFixture } from "../../../../scripts/test-copilot-decision-fixtures";
import { readRecommendationTracking } from "./recommendation-tracking-tool";
import { buildRecommendationTrackingMessages } from "./recommendation-tracking-messages";
import {
  recommendationChoiceSchema,
  recommendationTrackingInputSchema,
  readRecommendationTrackingCard,
} from "@fl-copilot/domain";
it.each(["READY", "FOREIGN", "QUOTE", "DELETED", "ARCHIVED", "USER"])(
  "keeps advice as an exact owned prior assistant quote (%s)",
  async (mode) => {
    const f = decisionFixture();
    const topic = {
        ...f.conversation,
        ...(mode === "ARCHIVED" ? { status: "ARCHIVED" } : {}),
        ...(mode === "DELETED" ? { deletedMessageIds: [f.source.id] } : {}),
      },
      source = { ...f.source, ...(mode === "USER" ? { role: "USER" } : {}) };
    const scope = {
      storeId: f.storeId,
      ownerId: mode === "FOREIGN" ? randomUUID() : f.ownerId,
      conversationId: f.conversation.id,
    };
    const db = {
      collection: (name: string) => ({
        findOne: async (q: Record<string, unknown>) =>
          q.ownerId !== f.ownerId
            ? null
            : name === "copilotConversations"
              ? { _id: topic.id, ...topic }
              : { _id: source.id, ...source },
      }),
    } as unknown as Db;
    const input = {
      ...f.input,
      ...(mode === "QUOTE" ? { quote: "Invented suggestion" } : {}),
    };
    const r = await readRecommendationTracking(db, scope, input);
    expect(r.status).toBe(mode === "READY" ? "READY" : "SOURCE_UNAVAILABLE");
    expect(r.evidence[0]?.value).not.toContain("enregistré comme exécuté");
    const messages = buildRecommendationTrackingMessages(f.assistant, [r, r]);
    expect(messages).toHaveLength(mode === "READY" ? 1 : 0);
    if (mode === "READY")
      expect(readRecommendationTrackingCard(messages[0]).content.basis).toEqual(
        r.basis,
      );
  },
);
it("rejects paraphrases with authority fields and incomplete decision forms", () => {
  const f = decisionFixture();
  expect(
    recommendationTrackingInputSchema.safeParse({
      ...f.input,
      ownerId: f.ownerId,
    }).success,
  ).toBe(false);
  for (const type of ["MODIFY", "POSTPONE"])
    expect(
      recommendationChoiceSchema.safeParse({
        type,
        modifiedAction: null,
        postponeUntil: null,
        reason: null,
      }).success,
    ).toBe(false);
});
