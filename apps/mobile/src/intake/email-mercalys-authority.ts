import {
  copilotImportReferenceSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import {
  emailIntakeDecisionSchema,
  emailIntakeReceiptSchema,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { emailProcessingIdentity } from "./email-processing-identity";
/** Recheck at every existing import proof, including its publication transaction. */
export async function assertEmailMercalysAuthority(
  db: OutboxDatabase,
  message: Pick<CopilotMessage, "storeId" | "ownerId" | "conversationId">,
  reference: ReturnType<typeof copilotImportReferenceSchema.parse>,
) {
  const origin = reference.emailOrigin;
  if (!origin) return;
  const row = await db.getFirstAsync<{
    payload_json: string;
    sync_state: string;
    dirty: number;
    remote_version: number | null;
    remote_payload_json: string | null;
  }>(
    "SELECT payload_json,remote_payload_json,sync_state,dirty,remote_version FROM email_intake_decisions WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    origin.receiptId,
    message.storeId,
    message.ownerId,
    message.conversationId,
  );
  if (
    !row ||
    row.sync_state !== "SYNCED" ||
    row.dirty ||
    row.remote_version !== 1 ||
    row.remote_payload_json !== row.payload_json
  )
    throw Error("EMAIL_INTAKE_DECISION_SYNC_REQUIRED");
  const decision = emailIntakeDecisionSchema.parse(
    JSON.parse(row.payload_json),
  );
  const selected = decision.files.find((f) => f.fileId === origin.fileId);
  if (
    decision.storeId !== message.storeId ||
    decision.ownerId !== message.ownerId ||
    decision.conversationId !== message.conversationId ||
    decision.receiptId !== origin.receiptId ||
    decision.actionId !== origin.actionId ||
    decision.choice !== "ADMIT" ||
    !selected ||
    selected.processingId !== origin.processingId ||
    selected.mode !== "AUTO" ||
    reference.batchId !== emailProcessingIdentity(message, origin, "BATCH")
  )
    throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
  const cached = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM email_intake_receipts WHERE id=? AND store_id=? AND owner_id=? AND conversation_id=?",
    origin.receiptId,
    message.storeId,
    message.ownerId,
    message.conversationId,
  );
  const receipt = cached
    ? emailIntakeReceiptSchema.parse(JSON.parse(cached.payload_json))
    : null;
  const file = receipt?.files.find((file) => file.id === origin.fileId);
  if (
    !receipt ||
    receipt.id !== origin.receiptId ||
    receipt.storeId !== message.storeId ||
    receipt.ownerId !== message.ownerId ||
    receipt.conversationId !== message.conversationId ||
    ["DISMISSED", "QUARANTINED"].includes(receipt.status) ||
    !file ||
    !["READY", "APPLIED"].includes(file.status)
  )
    throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
}
