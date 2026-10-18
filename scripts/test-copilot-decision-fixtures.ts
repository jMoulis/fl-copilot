import { randomUUID, createHash } from "node:crypto";
import { chatFixture } from "./test-chat-fixtures";
import {
  copilotMessageSchema,
  recommendationDecisionReadResultSchema,
  type CopilotMessage,
  type RecommendationChoice,
} from "../packages/domain/src/index";
import { buildRecommendationTrackingMessages } from "../apps/api/src/copilot/recommendation-tracking-messages";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { MercalysTestDatabase } from "./test-mercalys-sync-fixtures";
import { CopilotDecisionRepository } from "../apps/mobile/src/copilot/decision-repository";
export const decisionDigest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function decisionFixture(scope?: { storeId: string }) {
  const f = chatFixture(randomUUID);
  if (scope) {
    f.storeId = scope.storeId;
    f.conversation.storeId = scope.storeId;
    f.message.storeId = scope.storeId;
  }
  f.message.attachments = [];
  const source = copilotMessageSchema.parse({
    ...f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: f.message.id,
    createdAt: "2026-10-11T12:00:01.000Z",
    text: "Tester une TG de tomates près de l’entrée. Vérifier les chiffres avant de conclure.",
  });
  const request = copilotMessageSchema.parse({
    ...f.message,
    id: randomUUID(),
    createdAt: "2026-10-11T12:00:02.000Z",
    text: "Je veux suivre cette piste.",
  });
  const assistant = copilotMessageSchema.parse({
    ...request,
    id: randomUUID(),
    role: "ASSISTANT",
    replyToMessageId: request.id,
    createdAt: "2026-10-11T12:00:03.000Z",
    text: "Le suivi est préparé.",
  });
  const quote = "Tester une TG de tomates près de l’entrée.",
    input = { sourceMessageId: source.id, quote };
  const preview = {
    input,
    status: "READY" as const,
    basis: {
      sourceMessageId: source.id,
      sourceCreatedAt: source.createdAt,
      sourceDigest: createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex"),
      quote,
    },
    evidence: [
      {
        id: "tracking-test",
        sourceType: "DATA_QUALITY" as const,
        sourceId: source.id,
        sourceVersion: 1,
        label: "Piste à suivre",
        value: "Suivi préparé, sans choix enregistré.",
        factKind: "QUALITY" as const,
      },
    ],
  };
  const card = buildRecommendationTrackingMessages(assistant, [preview])[0]!;
  return {
    ...f,
    source,
    request,
    assistant,
    input,
    preview,
    card,
    recommendationId: JSON.parse(card.text).recommendationId as string,
  };
}
export const decisionChoiceFixture = (
  type: RecommendationChoice["type"],
): RecommendationChoice => ({
  type,
  modifiedAction: type === "MODIFY" ? "Tester sur une TG plus petite." : null,
  postponeUntil: type === "POSTPONE" ? "2026-10-25" : null,
  reason: null,
});
export async function decisionNativeFixture(
  f = decisionFixture(),
  db = new MercalysTestDatabase(),
) {
  await runLocalMigrations(db);
  const scope = {
    storeId: f.storeId,
    ownerId: f.ownerId,
    deviceId: f.deviceId,
    canDecide: true,
  };
  await applyCopilotRecord(db, scope, "copilot_conversation", f.conversation);
  for (const m of [f.message, f.source, f.request, f.assistant, f.card])
    await applyCopilotRecord(db, scope, "copilot_message", m);
  const repo = new CopilotDecisionRepository(
    db,
    scope,
    decisionDigest,
    randomUUID,
    () => "2026-10-18T12:00:00.000Z",
  );
  return { ...f, db, scope, repo };
}
export async function saveDecision(
  f: Pick<Awaited<ReturnType<typeof decisionNativeFixture>>, "repo" | "card">,
  type: RecommendationChoice["type"],
) {
  const s = await f.repo.open(f.card);
  return f.repo.save(f.card, decisionChoiceFixture(type), s.review);
}
export function withoutMongoId(row: { _id: unknown; [key: string]: unknown }) {
  const { _id, ...e } = row;
  void _id;
  return e as unknown as CopilotMessage;
}

/** A schema-valid owned choice for SDK/reader tests; no live provider call. */
export async function decisionReadFixture(
  storeId: string,
  type: RecommendationChoice["type"] = "ACCEPT",
) {
  const native = await decisionNativeFixture(decisionFixture({ storeId }));
  try {
    const saved = (await saveDecision(native, type)).decision!;
    const decision = {
      recommendationId: saved.id,
      expectedVersion: saved.version,
    };
    const context = recommendationDecisionReadResultSchema.parse({
      input: {
        conversationId: null,
        recommendationId: saved.id,
        afterId: null,
        limit: 1,
      },
      status: "READY",
      entries: [
        {
          id: saved.id,
          conversationId: saved.conversationId,
          version: saved.version,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
          latest: saved.revisions.at(-1),
          historyCount: saved.version,
          basis: native.preview.basis,
          sourceState: "ACTIVE",
        },
      ],
      hasMore: false,
      nextAfterId: null,
      evidence: [
        {
          id: "decision-test",
          sourceId: saved.id,
          sourceType: "EVENT",
          sourceVersion: saved.version,
          label: "Votre choix",
          value: "Choix conservé, pas une exécution.",
          factKind: "OBSERVED",
        },
        {
          id: "coverage-test",
          sourceId: storeId,
          sourceType: "DATA_QUALITY",
          sourceVersion: null,
          label: "Couverture",
          value: "Choix synchronisés seulement.",
          factKind: "QUALITY",
        },
      ],
    });
    return { ownerId: native.ownerId, decision, context };
  } finally {
    native.db.db.close();
  }
}
