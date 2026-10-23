import { z } from "zod";
import {
  actionExecutionSchema,
  recommendationDecisionSchema,
  readRecommendationTrackingCard,
  copilotMessageSchema,
  copilotConversationSchema,
  copilotMessageIsDeleted,
  copilotMessageContent,
  recommendationIdFromDigest,
  recommendationTrackingIdentityPayload,
  selectStoreEventTime,
  commercialExecutionActualsSummary,
  type RecommendationDecision,
  type CopilotConversation,
  type RecommendationChoice,
  type ActionExecution,
} from "@fl-copilot/domain";
import { addExplorerDays } from "@fl-copilot/analytics-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { actionsViewSchema, copilotActivityFilterSchema } from "./actions-view";

const kindSchema = z.enum(["DECISION", "EXECUTION"]);
const cursorSchema = z.strictObject({
  at: z.iso.datetime(),
  kind: kindSchema,
  id: z.uuid(),
});
export type CopilotActivityCursor = z.infer<typeof cursorSchema>;
export type CopilotActivityFilter = z.infer<typeof copilotActivityFilterSchema>;
type ActivityBase = {
  id: string;
  conversationId: string;
  at: string;
  label: string;
  detail: string | null;
  syncState: string;
  conversationAvailable: boolean;
  sourceAvailable: boolean;
};
export type CopilotActivityEntry = ActivityBase &
  (
    | {
        kind: "DECISION";
        status: RecommendationChoice["type"];
        postponedUntil: string | null;
      }
    | {
        kind: "EXECUTION";
        status: ActionExecution["status"];
        postponedUntil: null;
      }
  );
type Row = {
  id: string;
  kind: CopilotActivityEntry["kind"];
  conversation_id: string;
  at: string;
  payload_json: string;
  sync_state: string;
  topic_json: string | null;
  card_json: string | null;
  card_sync: string | null;
  parent_json: string | null;
  parent_sync: string | null;
  source_json: string | null;
};

/** Read-only, ten entries per page; business declarations survive removal of their chat. */
export class CopilotActivityRepository {
  constructor(
    private db: OutboxDatabase,
    private scope: { storeId: string; ownerId: string },
    private digest: (text: string) => Promise<string>,
  ) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.ownerId);
  }
  async page(
    weekStart: string,
    filter: CopilotActivityFilter = "ALL",
    after?: CopilotActivityCursor,
  ) {
    actionsViewSchema.shape.weekStart.parse(weekStart);
    copilotActivityFilterSchema.parse(filter);
    const cursor = after ? cursorSchema.parse(after) : undefined;
    const start = selectStoreEventTime(weekStart, "00:00"),
      end = selectStoreEventTime(addExplorerDays(weekStart, 7), "00:00");
    const rows = await this.db.getAllAsync<Row>(
      `
      WITH entries AS (
        SELECT 'DECISION' AS kind,id,conversation_id,payload_json,sync_state,
          json_extract(payload_json,'$.updatedAt') AS at,
          json_extract(payload_json,'$.revisions[#-1].proposalMessageId') AS proposal_id
        FROM copilot_decisions WHERE store_id=? AND owner_id=?
        UNION ALL
        SELECT 'EXECUTION',id,conversation_id,payload_json,sync_state,
          COALESCE(json_extract(payload_json,'$.withdrawnAt'),json_extract(payload_json,'$.createdAt')) AS at,
          json_extract(payload_json,'$.proposalMessageId') AS proposal_id
        FROM action_executions WHERE store_id=? AND owner_id=?
      )
      SELECT e.*,c.payload_json AS topic_json,m.payload_json AS card_json,m.sync_state AS card_sync,
        p.payload_json AS parent_json,p.sync_state AS parent_sync,s.payload_json AS source_json
      FROM entries e
      LEFT JOIN copilot_conversations c ON c.id=e.conversation_id AND c.store_id=? AND c.owner_id=?
      LEFT JOIN copilot_messages m ON m.id=e.proposal_id AND m.conversation_id=e.conversation_id AND m.store_id=? AND m.owner_id=?
      LEFT JOIN copilot_messages p ON p.id=CASE WHEN json_valid(m.payload_json) THEN CASE WHEN json_valid(json_extract(m.payload_json,'$.text'))
        THEN json_extract(json_extract(m.payload_json,'$.text'),'$.assistantMessageId') END END
        AND p.conversation_id=e.conversation_id AND p.store_id=? AND p.owner_id=?
      LEFT JOIN copilot_messages s ON s.id=CASE WHEN json_valid(m.payload_json) THEN CASE WHEN json_valid(json_extract(m.payload_json,'$.text'))
        THEN json_extract(json_extract(m.payload_json,'$.text'),'$.basis.sourceMessageId') END END
        AND s.conversation_id=e.conversation_id AND s.store_id=? AND s.owner_id=?
      WHERE e.at>=? AND e.at<? AND (?='ALL' OR e.kind=?)
        AND (? IS NULL OR (e.at,e.kind,e.id)<(?,?,?))
      ORDER BY e.at DESC,e.kind DESC,e.id DESC LIMIT 11`,
      ...Array.from({ length: 6 }, () => [
        this.scope.storeId,
        this.scope.ownerId,
      ]).flat(),
      start,
      end,
      filter,
      filter,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.kind ?? null,
      cursor?.id ?? null,
    );
    const entries = await Promise.all(
      rows.slice(0, 10).map((row) => this.entry(row)),
    );
    const last = entries.at(-1);
    return {
      entries,
      next:
        rows.length > 10 && last
          ? { at: last.at, kind: last.kind, id: last.id }
          : null,
    };
  }
  private owned(
    value: { storeId: string; ownerId: string; conversationId?: string },
    conversationId: string,
  ) {
    return (
      value.storeId === this.scope.storeId &&
      value.ownerId === this.scope.ownerId &&
      (value.conversationId === undefined ||
        value.conversationId === conversationId)
    );
  }
  private async basis(
    row: Row,
    decision: RecommendationDecision,
    topic: CopilotConversation | null,
  ) {
    try {
      if (
        !topic ||
        topic.deletedAt ||
        topic.status !== "ACTIVE" ||
        row.card_sync !== "SYNCED" ||
        row.parent_sync !== "SYNCED"
      )
        return null;
      const { message, content } = readRecommendationTrackingCard(
          JSON.parse(row.card_json!),
        ),
        parent = copilotMessageSchema.parse(JSON.parse(row.parent_json!)),
        source = row.source_json
          ? copilotMessageSchema.parse(JSON.parse(row.source_json))
          : null;
      if (
        ![message, parent, ...(source ? [source] : [])].every(
          (m) =>
            this.owned(m, decision.conversationId) &&
            !copilotMessageIsDeleted(m, topic),
        ) ||
        (topic.deletedMessageIds ?? []).includes(
          content.basis.sourceMessageId,
        ) ||
        message.id !== decision.revisions.at(-1)!.proposalMessageId ||
        parent.id !== content.assistantMessageId ||
        parent.role !== "ASSISTANT" ||
        parent.replyToMessageId !== message.replyToMessageId ||
        parent.createdAt > message.createdAt
      )
        return null;
      // The canonical decision editor permits a verified private card when older source history is not local yet.
      if (
        source &&
        (source.id !== content.basis.sourceMessageId ||
          source.role !== "ASSISTANT" ||
          source.createdAt !== content.basis.sourceCreatedAt ||
          !source.text.includes(content.basis.quote) ||
          (await this.digest(JSON.stringify(copilotMessageContent(source)))) !==
            content.basis.sourceDigest)
      )
        return null;
      const identity = await this.digest(
        recommendationTrackingIdentityPayload(message, content.basis),
      );
      return identity === decision.proposalDigest &&
        recommendationIdFromDigest(identity) === decision.id &&
        content.recommendationId === decision.id
        ? content.basis
        : null;
    } catch {
      return null;
    }
  }
  private async entry(row: Row): Promise<CopilotActivityEntry> {
    const record =
      row.kind === "DECISION"
        ? recommendationDecisionSchema.parse(JSON.parse(row.payload_json))
        : actionExecutionSchema.parse(JSON.parse(row.payload_json));
    if (!this.owned(record, row.conversation_id) || record.id !== row.id)
      throw Error("COPILOT_ACTIVITY_SCOPE_INVALID");
    const parsed = row.topic_json
      ? copilotConversationSchema.safeParse(privateJson(row.topic_json))
      : null;
    const topic =
      parsed?.success &&
      this.owned(parsed.data, row.conversation_id) &&
      parsed.data.id === row.conversation_id
        ? parsed.data
        : null;
    const base = {
      id: row.id,
      kind: row.kind,
      conversationId: row.conversation_id,
      at: row.at,
      syncState: z
        .enum(["PENDING", "SYNCED", "CONFLICT", "ERROR"])
        .parse(row.sync_state),
      conversationAvailable:
        !!topic && !topic.deletedAt && topic.status === "ACTIVE",
    };
    if ("revisions" in record) {
      const latest = record.revisions.at(-1)!,
        basis = await this.basis(row, record, topic);
      return {
        ...base,
        kind: "DECISION",
        status: latest.type,
        label: latest.modifiedAction ?? basis?.quote ?? "Conseil conservé",
        detail: latest.reason,
        postponedUntil: latest.postponeUntil,
        sourceAvailable: !!basis,
      };
    }
    return {
      ...base,
      kind: "EXECUTION",
      status: record.status,
      label: record.snapshot.action,
      detail: record.snapshot.actuals
        ? commercialExecutionActualsSummary(record.snapshot.actuals)
        : null,
      postponedUntil: null,
      sourceAvailable: base.conversationAvailable,
    };
  }
}

function privateJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
