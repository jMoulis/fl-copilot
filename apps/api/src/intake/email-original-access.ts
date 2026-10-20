import { createHash } from "node:crypto";
import { z } from "zod";
import {
  emailIntakeOriginalMetadataSchema,
  emailIntakeOriginalRequestSchema,
  emailIntakeOriginalDownloadSchema,
  serializeEmailIntakeOriginalMetadata,
} from "@fl-copilot/sync-contracts";
import { AuthError } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";
import {
  createVercelSourceBlobStorage,
  type SourceBlobStorage,
} from "../uploads/source-upload-service.js";
import { signPrivateOriginal } from "../uploads/private-original-link.js";
import {
  emailIntakeAuthorized,
  type EmailIntakeScope,
  type EmailIntakeReceiptRecord,
} from "./email-intake-store.js";
import {
  emailOriginalObjectKey,
  type EmailOriginalJob,
} from "./email-originals.js";
const targetSchema = emailIntakeOriginalRequestSchema.extend({
  storeId: z.uuid(),
  ownerId: z.uuid(),
});
export type EmailOriginalTarget = z.infer<typeof targetSchema>;
const unavailable = () =>
  new AuthError(
    404,
    "EMAIL_ORIGINAL_UNAVAILABLE",
    "Cet original n’est pas disponible pour cette conversation ou ce compte.",
  );
const invalid = () =>
  new AuthError(
    409,
    "EMAIL_ORIGINAL_CHANGED",
    "L’original a changé. Actualisez le document avant de le récupérer.",
  );

export function createEmailOriginalAccess(
  database: DatabaseService,
  storage: Pick<SourceBlobStorage, "head"> = createVercelSourceBlobStorage(),
  sign = signPrivateOriginal,
  now: () => Date = () => new Date(),
) {
  async function lookup(raw: EmailOriginalTarget) {
    const input = targetSchema.parse(raw),
      db = await database.getDb();
    const scope: EmailIntakeScope = {
      storeId: input.storeId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
    };
    if (!(await emailIntakeAuthorized(db, scope))) throw unavailable();
    const receipt = await db
      .collection<EmailIntakeReceiptRecord>("emailIntakeReceipts")
      .findOne(
        {
          _id: input.receiptId,
          ...scope,
          status: { $nin: ["DISMISSED", "QUARANTINED"] },
        },
        { maxTimeMS: 2000 },
      );
    const file = receipt?.files.find((f) => f.id === input.fileId);
    if (!receipt || !file || !["READY", "APPLIED"].includes(file.status))
      throw unavailable();
    const job = await db
      .collection<EmailOriginalJob>("emailIntakeOriginalJobs")
      .findOne(
        {
          _id: file.id,
          receiptId: receipt._id,
          ...scope,
          bindingId: receipt.bindingId,
          status: "DONE",
        },
        { maxTimeMS: 2000 },
      );
    if (!job?.proof) throw unavailable();
    const parsed = emailIntakeOriginalMetadataSchema.safeParse({
      schemaVersion: 1,
      ...scope,
      receiptId: receipt._id,
      fileId: file.id,
      providerEmailId: receipt.providerEmailId,
      providerAttachmentId: file.providerAttachmentId,
      filename: file.filename,
      declaredMimeType: job.proof.declaredMimeType,
      sizeBytes: job.proof.sizeBytes,
      checksum: job.proof.checksum,
      retainedAt:
        job.updatedAt instanceof Date &&
        Number.isFinite(job.updatedAt.getTime())
          ? job.updatedAt.toISOString()
          : null,
    });
    if (!parsed.success || parsed.data.declaredMimeType !== file.mediaType)
      throw invalid();
    const metadata = parsed.data,
      key = emailOriginalObjectKey(job, metadata.checksum);
    if (key !== job.proof.objectKey) throw invalid();
    return {
      key,
      manifest: {
        ...metadata,
        manifestHash: `sha256:${createHash("sha256").update(serializeEmailIntakeOriginalMetadata(metadata)).digest("hex")}`,
      },
    };
  }
  async function checked(
    input: EmailOriginalTarget,
    authorize?: () => Promise<void>,
  ) {
    await authorize?.();
    const before = await lookup(input);
    const blob = await storage.head(before.key);
    if (!blob) throw unavailable();
    if (
      blob.pathname !== before.key ||
      blob.size !== before.manifest.sizeBytes ||
      blob.contentType !== before.manifest.declaredMimeType
    )
      throw invalid();
    const current = await lookup(input);
    await authorize?.();
    if (before.manifest.manifestHash !== current.manifest.manifestHash)
      throw invalid();
    return current;
  }
  return {
    async manifest(
      input: EmailOriginalTarget,
      authorize?: () => Promise<void>,
    ) {
      return (await checked(input, authorize)).manifest;
    },
    async download(
      input: EmailOriginalTarget,
      authorize?: () => Promise<void>,
    ) {
      const current = await checked(input, authorize),
        expiry = now().getTime() + 120000;
      const url = await sign(current.key, expiry);
      const latest = await lookup(input);
      await authorize?.();
      if (latest.manifest.manifestHash !== current.manifest.manifestHash)
        throw invalid();
      if (now().getTime() >= expiry) throw unavailable();
      return emailIntakeOriginalDownloadSchema.parse({
        manifest: current.manifest,
        url,
        expiresAt: new Date(expiry).toISOString(),
      });
    },
  };
}
export type EmailOriginalAccess = ReturnType<typeof createEmailOriginalAccess>;
