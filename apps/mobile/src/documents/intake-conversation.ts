import { copilotConversationSchema } from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
/** Native scope, not an instruction from source contents or model output. */
export async function assertIntakeConversation(
  db: OutboxDatabase,
  scope: { storeId: string; ownerId: string },
  conversationId?: string | null,
) {
  if (!conversationId) return;
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM copilot_conversations WHERE id=? AND store_id=? AND owner_id=?",
    conversationId,
    scope.storeId,
    scope.ownerId,
  );
  const c = row
    ? copilotConversationSchema.parse(JSON.parse(row.payload_json))
    : null;
  if (
    !c ||
    c.id !== conversationId ||
    c.storeId !== scope.storeId ||
    c.ownerId !== scope.ownerId ||
    c.status !== "ACTIVE"
  )
    throw Error("MERCALYS_BATCH_CONVERSATION_INVALID");
}
