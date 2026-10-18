import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  recommendationDecisionReadInputSchema,
  recommendationDecisionReadResultSchema,
  readRecommendationTrackingCard,
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  recommendationTrackingIdentityPayload,
  recommendationIdFromDigest,
} from "@fl-copilot/domain";
import { recommendationSourceDigest } from "./recommendation-tracking-tool.js";
import { serializeDecision, type DecisionDocument } from "./decision-store.js";
export async function readRecommendationDecisions(
  db: Db,
  scope: { storeId: string; ownerId: string },
  raw: unknown,
) {
  z.uuid().parse(scope.storeId);
  z.uuid().parse(scope.ownerId);
  const input = recommendationDecisionReadInputSchema.parse(raw);
  const topicRows = input.conversationId
    ? await db
        .collection<{ _id: string; [key: string]: unknown }>(
          "copilotConversations",
        )
        .find({ ...scope, _id: input.conversationId })
        .maxTimeMS(2000)
        .limit(1)
        .toArray()
    : [];
  const topics = new Map(
    topicRows.map((r) => {
      const { _id, ...p } = r;
      const e = copilotConversationSchema.parse(p);
      if (
        e.id !== _id ||
        e.storeId !== scope.storeId ||
        e.ownerId !== scope.ownerId
      )
        throw Error("COPILOT_DECISION_SCOPE_INVALID");
      return [e.id, e] as const;
    }),
  );
  const status =
    input.conversationId && !topics.has(input.conversationId)
      ? ("CONVERSATION_UNAVAILABLE" as const)
      : ("READY" as const);
  const rows =
    status !== "READY"
      ? []
      : await db
          .collection<DecisionDocument>("copilotDecisions")
          .find({
            ...scope,
            ...(input.conversationId
              ? { conversationId: input.conversationId }
              : {}),
            ...(input.recommendationId ? { _id: input.recommendationId } : {}),
            ...(input.afterId
              ? {
                  _id: {
                    ...(input.recommendationId
                      ? { $eq: input.recommendationId }
                      : {}),
                    $gt: input.afterId,
                  },
                }
              : {}),
          })
          .sort({ _id: 1 })
          .maxTimeMS(2000)
          .limit(input.limit + 1)
          .toArray();
  const all = rows.map(serializeDecision);
  if (
    all.some((e) => e.storeId !== scope.storeId || e.ownerId !== scope.ownerId)
  )
    throw Error("COPILOT_DECISION_SCOPE_INVALID");
  const page = all.slice(0, input.limit),
    hasMore = all.length > input.limit;
  if (!input.conversationId && page.length) {
    const linkedTopics = await db
      .collection<{ _id: string; [key: string]: unknown }>(
        "copilotConversations",
      )
      .find({
        ...scope,
        _id: { $in: [...new Set(page.map((e) => e.conversationId))] },
      })
      .maxTimeMS(2000)
      .limit(10)
      .toArray();
    for (const { _id, ...payload } of linkedTopics) {
      const e = copilotConversationSchema.parse(payload);
      if (
        e.id !== _id ||
        e.storeId !== scope.storeId ||
        e.ownerId !== scope.ownerId
      )
        throw Error("COPILOT_DECISION_SCOPE_INVALID");
      topics.set(e.id, e);
    }
  }
  const cardIds = page.map((e) => e.revisions.at(-1)!.proposalMessageId);
  const rawCards = cardIds.length
    ? await db
        .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
        .find({ ...scope, _id: { $in: cardIds } })
        .maxTimeMS(2000)
        .limit(10)
        .toArray()
    : [];
  const cards = new Map(
    rawCards.map((r) => {
      const { _id, ...p } = r;
      const c = readRecommendationTrackingCard(p);
      if (
        c.message.id !== _id ||
        c.message.ownerId !== scope.ownerId ||
        c.message.storeId !== scope.storeId
      )
        throw Error("COPILOT_DECISION_SCOPE_INVALID");
      return [c.message.id, c] as const;
    }),
  );
  const sourceIds = [...cards.values()].map(
    (c) => c.content.basis.sourceMessageId,
  );
  const rawSources = sourceIds.length
    ? await db
        .collection<{ _id: string; [key: string]: unknown }>("copilotMessages")
        .find({ ...scope, _id: { $in: sourceIds } })
        .maxTimeMS(2000)
        .limit(10)
        .toArray()
    : [];
  const sources = new Map(
    rawSources.map((r) => {
      const { _id, ...p } = r;
      const e = copilotMessageSchema.parse(p);
      if (
        e.id !== _id ||
        e.ownerId !== scope.ownerId ||
        e.storeId !== scope.storeId
      )
        throw Error("COPILOT_DECISION_SCOPE_INVALID");
      return [e.id, e] as const;
    }),
  );
  const entries = page.map((e) => {
    const c = cards.get(e.revisions.at(-1)!.proposalMessageId),
      topic = topics.get(e.conversationId),
      source = c ? sources.get(c.content.basis.sourceMessageId) : null;
    if (
      c &&
      (c.content.recommendationId !== e.id ||
        c.message.conversationId !== e.conversationId ||
        createHash("sha256")
          .update(
            recommendationTrackingIdentityPayload(c.message, c.content.basis),
          )
          .digest("hex") !== e.proposalDigest ||
        recommendationIdFromDigest(e.proposalDigest) !== e.id)
    )
      throw Error("COPILOT_DECISION_SCOPE_INVALID");
    return {
      id: e.id,
      conversationId: e.conversationId,
      version: e.version,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      latest: e.revisions.at(-1)!,
      historyCount: e.revisions.length,
      basis: c?.content.basis ?? null,
      sourceState:
        !c ||
        !topic ||
        !source ||
        source.role !== "ASSISTANT" ||
        source.conversationId !== e.conversationId ||
        recommendationSourceDigest(source) !== c.content.basis.sourceDigest
          ? ("UNAVAILABLE" as const)
          : topic.status !== "ACTIVE" ||
              copilotMessageIsDeleted(c.message, topic) ||
              copilotMessageIsDeleted(source, topic)
            ? ("INACTIVE_SOURCE" as const)
            : ("ACTIVE" as const),
    };
  });
  const digest = createHash("sha256")
      .update(JSON.stringify([scope, input, entries, hasMore]))
      .digest("hex"),
    labels = {
      ACCEPT: "Acceptée",
      MODIFY: "Action modifiée",
      POSTPONE: "Reportée",
      REJECT: "Refusée",
    };
  const evidence = entries.map((e) => ({
    id: `decision/${e.id}/v${e.version}/${digest}`,
    sourceType: "EVENT" as const,
    sourceId: e.id,
    sourceVersion: e.version,
    label:
      "Votre décision — " +
      (e.basis?.quote.slice(0, 80) ?? "Conseil d’origine indisponible"),
    value: `${labels[e.latest.type]} le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(e.latest.decidedAt))}. ${e.basis ? "Proposition du chat : « " + e.basis.quote + " ». " : ""}${e.latest.modifiedAction ? "Action retenue : " + e.latest.modifiedAction + ". " : ""}${e.latest.postponeUntil ? "À reprendre le " + e.latest.postponeUntil + ". " : ""}${e.latest.reason ? "Note : " + e.latest.reason + ". " : ""}Contexte non revalidé ; source ${{ ACTIVE: "active dans le chat", INACTIVE_SOURCE: "archivée ou retirée", UNAVAILABLE: "indisponible" }[e.sourceState]}. Décision enregistrée, pas preuve d’exécution ni validation des faits. Dernier choix sur ${e.historyCount} décisions ; l’historique complet n’est pas consulté ici.`,
    factKind: "OBSERVED" as const,
  }));
  return recommendationDecisionReadResultSchema.parse({
    input,
    status,
    entries,
    hasMore,
    nextAfterId: hasMore ? page.at(-1)!.id : null,
    evidence: [
      ...evidence,
      {
        id: `decision-coverage/${digest}`,
        sourceType: "DATA_QUALITY",
        sourceId: scope.storeId,
        sourceVersion: null,
        label: "Couverture du suivi des décisions",
        value: `${entries.length} choix dans cette page${hasMore ? " ; d’autres choix restent à consulter" : ""}. Seules les décisions synchronisées de ce compte et de ce magasin sont visibles. Les choix restés sur un appareil peuvent manquer. Source active ne signifie pas contexte ou chiffres revalidés. Accepter, modifier, reporter ou refuser n’exécute aucune action.`,
        factKind: "QUALITY",
      },
    ],
  });
}
