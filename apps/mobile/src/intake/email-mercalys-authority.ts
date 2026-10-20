import {
  copilotImportReferenceSchema,
  type CopilotMessage,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { emailProcessingIdentity } from "./email-processing-identity";
import { readEmailProcessingAuthority } from "./email-processing-basis";
/** Recheck at every existing import proof, including its publication transaction. */
export async function assertEmailMercalysAuthority(
  db: OutboxDatabase,
  message: Pick<CopilotMessage, "storeId" | "ownerId" | "conversationId">,
  reference: ReturnType<typeof copilotImportReferenceSchema.parse>,
) {
  const origin = reference.emailOrigin;
  if (!origin) return;
  const { selection } = await readEmailProcessingAuthority(db, message, origin);
  if (
    selection.mode !== "AUTO" ||
    reference.batchId !== emailProcessingIdentity(message, origin, "BATCH")
  )
    throw Error("EMAIL_INTAKE_PROCESSING_FORBIDDEN");
}
