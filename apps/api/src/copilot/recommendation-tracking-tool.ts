import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  recommendationTrackingInputSchema,
  recommendationTrackingPreviewSchema,
} from "@fl-copilot/domain";
export const recommendationSourceDigest = (raw: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(copilotMessageSchema.parse(raw)))
    .digest("hex");
export async function readRecommendationTracking(
  db: Db,
  scope: { storeId: string; ownerId: string; conversationId: string },
  raw: unknown,
) {
  z.uuid().parse(scope.storeId);
  z.uuid().parse(scope.ownerId);
  z.uuid().parse(scope.conversationId);
  const input = recommendationTrackingInputSchema.parse(raw);
  const row = await db
    .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
    .findOne({ _id: input.sourceMessageId, ...scope }, { maxTimeMS: 2000 });
  const topic = await db
    .collection<{ _id: string; [key: string]: unknown }>("copilotConversations")
    .findOne(
      {
        _id: scope.conversationId,
        storeId: scope.storeId,
        ownerId: scope.ownerId,
      },
      { maxTimeMS: 2000 },
    );
  const source = row
    ? copilotMessageSchema.parse(
        (({ _id, ...p }) => {
          void _id;
          return p;
        })(row),
      )
    : null;
  const conversation = topic
    ? copilotConversationSchema.parse(
        (({ _id, ...p }) => {
          void _id;
          return p;
        })(topic),
      )
    : null;
  const ready =
    source &&
    conversation &&
    source.id === input.sourceMessageId &&
    source.role === "ASSISTANT" &&
    source.conversationId === scope.conversationId &&
    source.storeId === scope.storeId &&
    source.ownerId === scope.ownerId &&
    conversation.id === scope.conversationId &&
    conversation.storeId === scope.storeId &&
    conversation.ownerId === scope.ownerId &&
    conversation.status === "ACTIVE" &&
    !copilotMessageIsDeleted(source, conversation) &&
    source.text.includes(input.quote);
  return recommendationTrackingPreviewSchema.parse({
    input,
    status: ready ? "READY" : "SOURCE_UNAVAILABLE",
    basis: ready
      ? {
          sourceMessageId: source.id,
          sourceCreatedAt: source.createdAt,
          sourceDigest: recommendationSourceDigest(source),
          quote: input.quote,
        }
      : null,
    evidence: [
      {
        id: `recommendation-tracking/${scope.conversationId}/${input.sourceMessageId}/${createHash(
          "sha256",
        )
          .update(JSON.stringify([input, ready ? source : null]))
          .digest("hex")}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.sourceMessageId,
        sourceVersion: ready ? 1 : null,
        label: "Piste du chat à suivre",
        value: ready
          ? `Proposition antérieure du chat : « ${input.quote} ». Préparation d’un suivi. Les faits et le contexte ne sont pas revalidés ici ; aucun choix ni aucune action n’est encore enregistré.`
          : "Le message d’origine ou l’extrait exact n’est pas disponible dans cette conversation active. Aucun suivi préparé.",
        factKind: "QUALITY",
      },
    ],
  });
}
