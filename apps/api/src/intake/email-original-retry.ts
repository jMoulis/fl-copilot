import { z } from "zod";
import {
  emailIntakeOriginalRetrySchema,
  type EmailIntakeOriginalRetry,
} from "@fl-copilot/sync-contracts";
import type { ClientSession } from "mongodb";
import { AuthError } from "../auth/service.js";
import type { EmailIntakeReceiptRecord } from "./email-intake-store.js";
import type { DatabaseService } from "../database/types.js";
import {
  createMongoProcessedCommandService,
  ProcessedCommandIdentityError,
} from "../sync/processed-command-service.js";
import {
  emailOriginalScope,
  type EmailOriginalJob,
} from "./email-originals.js";
/** Explicit transport recovery, not admission, classification, publication or a new runner. */
export function createEmailOriginalRetry(
  database: DatabaseService,
  now: () => Date = () => new Date(),
) {
  const commands = createMongoProcessedCommandService(database, now);
  return {
    async request(
      raw: EmailIntakeOriginalRetry,
      actor: { storeId: string; ownerId: string; deviceId: string },
    ) {
      const input = emailIntakeOriginalRetrySchema.parse(raw);
      for (const id of Object.values(actor)) z.uuid().parse(id);
      const db = await database.getDb();
      const inspect = async (session?: ClientSession) => {
        const job = await db
          .collection<EmailOriginalJob>("emailIntakeOriginalJobs")
          .findOne(
            {
              _id: input.fileId,
              receiptId: input.receiptId,
              storeId: actor.storeId,
              ownerId: actor.ownerId,
              conversationId: input.conversationId,
            },
            { session, maxTimeMS: 2000 },
          );
        if (!job)
          throw new AuthError(
            404,
            "EMAIL_ORIGINAL_NOT_FOUND",
            "Cette pièce jointe n’est pas disponible pour ce compte.",
          );
        try {
          return { job, ...(await emailOriginalScope(db, job, session)) };
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "EMAIL_ATTACHMENT_SCOPE_CHANGED"
          )
            throw new AuthError(
              403,
              "EMAIL_ORIGINAL_RETRY_FORBIDDEN",
              "L’accès à cette réception a changé.",
            );
          throw error;
        }
      };
      // Current authority governs cached replay as well as mutation.
      await inspect();
      try {
        const result = await commands.execute(
          {
            commandId: input.actionId,
            ...actor,
            commandType: "EMAIL_ORIGINAL_RETRY",
            entityType: "email_original_job",
            entityId: input.fileId,
          },
          async ({ session }) => {
            const { job, file } = await inspect(session);
            if (
              file.status === "FAILED" &&
              job.status === "DONE" &&
              [
                "READ_FAILED",
                "PROVIDER_UNAVAILABLE",
                "STORAGE_UNAVAILABLE",
              ].includes(file.errorCode ?? "")
            ) {
              const timestamp = now();
              const changed = await db
                .collection<EmailOriginalJob>("emailIntakeOriginalJobs")
                .updateOne(
                  { _id: job._id, status: "DONE", attempts: job.attempts },
                  {
                    $set: {
                      status: "PENDING",
                      nextAttemptAt: timestamp,
                      updatedAt: timestamp,
                      retryAttemptBase:
                        job.attempts - (job.budgetDeferrals ?? 0),
                    },
                    $unset: { leaseId: "", leaseUntil: "" },
                  },
                  { session },
                );
              if (changed.matchedCount !== 1)
                throw Error("EMAIL_ORIGINAL_RETRY_CHANGED");
              await db
                .collection<EmailIntakeReceiptRecord>("emailIntakeReceipts")
                .updateOne(
                  { _id: job.receiptId, "files.id": job._id },
                  {
                    $set: { "files.$.status": "PENDING", updatedAt: timestamp },
                    $unset: { "files.$.errorCode": "", "files.$.retryAt": "" },
                    $inc: { version: 1 },
                  },
                  { session },
                );
            } else if (!["PENDING", "READY", "APPLIED"].includes(file.status)) {
              return {
                resultStatus: "REJECTED",
                responseJson: { code: "EMAIL_ORIGINAL_RETRY_NOT_ALLOWED" },
              };
            }
            // Active or already retained work is a no-op; never erase its lease/proof/quota.
            return { resultStatus: "APPLIED" };
          },
        );
        if (result.command.resultStatus !== "APPLIED")
          throw new AuthError(
            409,
            "EMAIL_ORIGINAL_RETRY_NOT_ALLOWED",
            "Ce fichier ne peut pas être repris tel quel. Conservez l’original et envoyez une nouvelle source si nécessaire.",
          );
      } catch (error) {
        if (error instanceof ProcessedCommandIdentityError)
          throw new AuthError(
            409,
            "EMAIL_ORIGINAL_RETRY_REUSED",
            "Cette demande de reprise appartient à une autre opération.",
          );
        throw error;
      }
      await inspect();
      return { actionId: input.actionId };
    },
  };
}
export type EmailOriginalRetry = ReturnType<typeof createEmailOriginalRetry>;
