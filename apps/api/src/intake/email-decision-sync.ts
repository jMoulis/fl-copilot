import type { ClientSession, Db } from "mongodb";
import {
  emailIntakeDecisionSchema,
  type EmailIntakeDecision,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import {
  emailIntakeAuthorized,
  type EmailIntakeReceiptRecord,
} from "./email-intake-store";
import {
  emailOriginalManifest,
  type EmailOriginalJob,
} from "./email-originals";
export type EmailDecisionDocument = EmailIntakeDecision & { _id: string };
export function serializeEmailDecision(row: EmailDecisionDocument) {
  const { _id, ...payload } = row;
  const decision = emailIntakeDecisionSchema.parse(payload);
  if (decision.id !== _id)
    throw Error("EMAIL_INTAKE_DECISION_IDENTITY_INVALID");
  return decision;
}
/** Runs before processed-command replay, and again inside its transaction. */
export async function canAccessEmailDecision(
  db: Db,
  storeId: string,
  ownerId: string | undefined,
  command: SyncCommand,
  session?: ClientSession,
) {
  const parsed = emailIntakeDecisionSchema.safeParse(command.payload);
  if (
    !ownerId ||
    !parsed.success ||
    command.entityType !== "email_intake_decision" ||
    command.type !== "EMAIL_INTAKE_DECIDE" ||
    parsed.data.id !== command.entityId ||
    parsed.data.actionId !== command.commandId ||
    parsed.data.storeId !== storeId ||
    parsed.data.ownerId !== ownerId
  )
    return false;
  const decision = parsed.data;
  if (
    !(await emailIntakeAuthorized(
      db,
      { storeId, ownerId, conversationId: decision.conversationId },
      session,
    ))
  )
    return false;
  const old = await db
    .collection<EmailDecisionDocument>("emailIntakeDecisions")
    .findOne({ _id: decision.id }, { session, maxTimeMS: 2000 });
  return (
    !old ||
    (old.storeId === storeId &&
      old.ownerId === ownerId &&
      old.conversationId === decision.conversationId &&
      (old.actionId !== decision.actionId ||
        JSON.stringify(serializeEmailDecision(old)) ===
          JSON.stringify(decision)))
  );
}
export async function applyEmailDecision(
  ctx: MongoCommandMutationContext,
  storeId: string,
  ownerId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
  now: () => Date = () => new Date(),
): Promise<CommandMutationResult> {
  const reject = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Actualisez les fichiers reçus et confirmez à nouveau les documents à traiter.",
        retryable: false,
        requestId,
      },
    },
  });
  if (
    !(await canAccessEmailDecision(
      ctx.database,
      storeId,
      ownerId,
      command,
      ctx.session,
    ))
  )
    return reject("EMAIL_INTAKE_DECISION_SCOPE_INVALID");
  const decision = emailIntakeDecisionSchema.parse(command.payload),
    col = ctx.database.collection<EmailDecisionDocument>(
      "emailIntakeDecisions",
    );
  const old = await col.findOne({ _id: decision.id }, { session: ctx.session });
  if (old) {
    const remote = serializeEmailDecision(old);
    if (JSON.stringify(remote) === JSON.stringify(decision))
      return {
        resultStatus: "APPLIED",
        resultingVersion: 1,
        responseJson: { remoteEntity: remote },
      };
    return {
      resultStatus: "CONFLICT",
      resultingVersion: 1,
      responseJson: {
        remoteEntity: remote,
        error: {
          code: "EMAIL_INTAKE_DECISION_CONFLICT",
          messageFr:
            "Une décision a déjà été synchronisée pour cet email. Comparez les choix avant de poursuivre.",
          retryable: false,
          requestId,
        },
      },
    };
  }
  if (command.expectedRemoteVersion != null)
    return reject("EMAIL_INTAKE_DECISION_IMMUTABLE");
  const receipts = ctx.database.collection<EmailIntakeReceiptRecord>(
    "emailIntakeReceipts",
  );
  const receipt = await receipts.findOne(
    {
      _id: decision.receiptId,
      storeId,
      ownerId,
      conversationId: decision.conversationId,
    },
    { session: ctx.session, maxTimeMS: 2000 },
  );
  if (
    !receipt ||
    receipt.status !== "AWAITING_CONFIRMATION" ||
    receipt.version < decision.receiptVersion
  )
    return reject("EMAIL_INTAKE_RECEIPT_CHANGED");
  for (const selected of decision.files) {
    const file = receipt.files.find((file) => file.id === selected.fileId);
    if (
      !file ||
      !["READY", "PENDING", "FAILED"].includes(file.status) ||
      file.sourceDocumentId !== null
    )
      return reject("EMAIL_INTAKE_FILE_UNAVAILABLE");
    if (file.status !== "READY" && selected.manifestHash !== null)
      return reject("EMAIL_INTAKE_FILE_UNAVAILABLE");
    if (file.status === "READY") {
      const job = await ctx.database
        .collection<EmailOriginalJob>("emailIntakeOriginalJobs")
        .findOne(
          {
            _id: file.id,
            receiptId: receipt._id,
            storeId,
            ownerId,
            conversationId: decision.conversationId,
          },
          { session: ctx.session, maxTimeMS: 2000 },
        );
      const manifest = job ? emailOriginalManifest(receipt, file, job) : null;
      if (
        !manifest ||
        (selected.manifestHash !== null &&
          manifest.manifestHash !== selected.manifestHash) ||
        (selected.checksum !== null && manifest.checksum !== selected.checksum)
      )
        return reject("EMAIL_INTAKE_ORIGINAL_CHANGED");
    }
    // MIME is declared source metadata. The selected mode is human intent;
    // the canonical file pipeline still validates actual format before use.
  }

  // Match the bounded private bootstrap without allowing concurrent admissions
  // to exceed its restorable history. A refusal leaves the source batch intact.
  const counters = ctx.database.collection<{
    _id: string;
    storeId: string;
    ownerId: string;
    count: number;
  }>("copilotPrivateCounters");
  const key = `email-intake-decisions:${storeId}:${ownerId}`;
  if (!(await counters.findOne({ _id: key }, { session: ctx.session }))) {
    const count = await col.countDocuments(
      { storeId, ownerId },
      { session: ctx.session, limit: 500 },
    );
    await counters.updateOne(
      { _id: key },
      { $setOnInsert: { storeId, ownerId, count } },
      { upsert: true, session: ctx.session },
    );
  }
  const reserved = await counters.updateOne(
    { _id: key, storeId, ownerId, count: { $lt: 500 } },
    { $inc: { count: 1 } },
    { session: ctx.session },
  );
  if (!reserved.matchedCount) return reject("EMAIL_INTAKE_DECISION_LIMIT");
  const changed = await receipts.updateOne(
    {
      _id: receipt._id,
      storeId,
      ownerId,
      version: receipt.version,
      status: receipt.status,
    },
    {
      $inc: { version: 1 },
      $set: {
        status: decision.choice === "ADMIT" ? "CONFIRMED" : "DISMISSED",
        updatedAt: now(),
      },
    },
    { session: ctx.session },
  );
  if (changed.matchedCount !== 1) throw Error("EMAIL_INTAKE_RECEIPT_CHANGED");
  await col.insertOne(
    { ...decision, _id: decision.id },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "email_intake_decision",
    entityId: decision.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: 1,
    responseJson: { remoteEntity: decision },
  };
}
