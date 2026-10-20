import { MAX_RECEIPT_VIEWS } from "@fl-copilot/domain";
import { z } from "zod";
import { sourceOriginalDownloadSchema } from "./source-original";
const id = z.uuid(),
  time = z.iso.datetime().max(40);
export const emailIntakeReceivingDomainSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.resend\.app$/);
const mailbox = z.email().max(320).toLowerCase();
export const emailIntakeBindingRequestSchema = z.strictObject({
  id,
  conversationId: id,
  allowedSender: mailbox,
});
export const emailIntakeBindingSchema = z.strictObject({
  id,
  storeId: id,
  ownerId: id,
  conversationId: id,
  recipient: mailbox,
  allowedSender: mailbox,
  createdAt: time,
  revokedAt: time.nullable(),
});
export const emailIntakeReceiptSchema = z
  .strictObject({
    id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    bindingId: id,
    providerEmailId: id,
    sender: mailbox,
    subject: z.string().max(998),
    receivedAt: time,
    updatedAt: time,
    version: z.number().int().positive(),
    status: z.enum([
      "AWAITING_CONFIRMATION",
      "CONFIRMED",
      "DISMISSED",
      "QUARANTINED",
      "PROCESSING",
      "PARTIAL",
      "COMPLETE",
    ]),
    files: z
      .array(
        z.strictObject({
          id,
          providerAttachmentId: id,
          filename: z.string().max(1024).nullable(),
          mediaType: z.string().min(1).max(120),
          status: z.enum([
            "PENDING",
            "READY",
            "UNSUPPORTED",
            "FAILED",
            "APPLIED",
          ]),
          sourceDocumentId: id.nullable(),
          retryAt: z.iso.datetime({ offset: true }).optional(),
          errorCode: z
            .enum([
              "UNSUPPORTED",
              "TOO_LARGE",
              "IDENTITY_CHANGED",
              "SCOPE_CHANGED",
              "PROVIDER_UNAVAILABLE",
              "STORAGE_UNAVAILABLE",
              "READ_FAILED",
              "DAILY_LIMIT",
            ])
            .optional(),
        }),
      )
      .max(50),
  })
  .superRefine((value, ctx) => {
    value.files.forEach((file, index) => {
      if (
        (file.errorCode === "DAILY_LIMIT" &&
          (file.status !== "PENDING" || !file.retryAt)) ||
        (file.retryAt &&
          (file.status !== "PENDING" || file.errorCode !== "DAILY_LIMIT"))
      )
        ctx.addIssue({
          code: "custom",
          path: ["files", index, "retryAt"],
          message:
            "Daily-limit availability requires a pending source and deadline",
        });
    });
    for (const key of ["id", "providerAttachmentId"] as const)
      if (
        new Set(value.files.map((file) => file[key])).size !==
        value.files.length
      )
        ctx.addIssue({
          code: "custom",
          path: ["files"],
          message: "Duplicate intake file identity",
        });
  });
export const emailIntakeListSchema = z.strictObject({
  bindings: z.array(emailIntakeBindingSchema).max(50),
  receipts: z.array(emailIntakeReceiptSchema).max(50),
  nextCursor: z.string().min(1).max(1024).nullable(),
});
export type EmailIntakeBinding = z.infer<typeof emailIntakeBindingSchema>;
export type EmailIntakeReceipt = z.infer<typeof emailIntakeReceiptSchema>;
export type EmailIntakeBindingRequest = z.infer<
  typeof emailIntakeBindingRequestSchema
>;

export const emailIntakeStatusSchema = z.strictObject({ enabled: z.boolean() });
export const emailIntakeRevocationSchema = z.strictObject({
  revoked: z.literal(true),
});

/** Private raw email bytes, before source classification. No canonical source type is invented. */
export const emailIntakeOriginalRequestSchema = z.strictObject({
  conversationId: id,
  receiptId: id,
  fileId: id,
});
export const emailIntakeReceiptRequestSchema =
  emailIntakeOriginalRequestSchema.omit({ fileId: true });
export type EmailIntakeReceiptRequest = z.infer<
  typeof emailIntakeReceiptRequestSchema
>;
export type EmailIntakeOriginalRequest = z.infer<
  typeof emailIntakeOriginalRequestSchema
>;
export const emailIntakeOriginalMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  storeId: id,
  ownerId: id,
  conversationId: id,
  receiptId: id,
  fileId: id,
  providerEmailId: id,
  providerAttachmentId: id,
  filename: z.string().max(1024).nullable(),
  declaredMimeType: z.string().min(1).max(120),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  retainedAt: time,
});
export const emailIntakeOriginalManifestSchema =
  emailIntakeOriginalMetadataSchema.extend({
    manifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  });
export const emailIntakeOriginalDownloadSchema = z.strictObject({
  manifest: emailIntakeOriginalManifestSchema,
  url: sourceOriginalDownloadSchema.shape.url,
  expiresAt: time,
});
export function serializeEmailIntakeOriginalMetadata(raw: unknown) {
  return JSON.stringify(emailIntakeOriginalMetadataSchema.parse(raw));
}
export type EmailIntakeOriginalManifest = z.infer<
  typeof emailIntakeOriginalManifestSchema
>;
export type EmailIntakeOriginalDownload = z.infer<
  typeof emailIntakeOriginalDownloadSchema
>;

/** Authenticated human admission; receiving metadata or an email body cannot create it. */
export const emailIntakeDecisionSchema = z
  .strictObject({
    id,
    receiptId: id,
    actionId: id,
    storeId: id,
    ownerId: id,
    conversationId: id,
    version: z.literal(1),
    policyVersion: z.literal(1),
    receiptVersion: z.number().int().positive(),
    choice: z.enum(["ADMIT", "DISMISS"]),
    files: z
      .array(
        z.strictObject({
          fileId: id,
          manifestHash: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/)
            .nullable(),
          checksum: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/)
            .nullable(),
          processingId: id,
          mode: z.enum(["AUTO", "WASTE_TICKET", "STORE_PHOTO"]),
        }),
      )
      .max(50),
    createdAt: time,
    updatedAt: time,
  })
  .superRefine((value, ctx) => {
    if (
      value.id !== value.receiptId ||
      value.updatedAt !== value.createdAt ||
      (value.choice === "ADMIT"
        ? !value.files.length
        : value.files.length !== 0) ||
      new Set(value.files.map((file) => file.fileId)).size !==
        value.files.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid immutable email admission",
      });
    if (
      value.files.some(
        (file) => (file.manifestHash === null) !== (file.checksum === null),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "Incomplete retained-byte proof",
      });
    const groups = new Map<string, typeof value.files>();
    for (const file of value.files)
      groups.set(file.processingId, [
        ...(groups.get(file.processingId) ?? []),
        file,
      ]);
    for (const files of groups.values())
      if (
        files.length > MAX_RECEIPT_VIEWS ||
        (files.length > 1 && files.some((file) => file.mode !== "WASTE_TICKET"))
      )
        ctx.addIssue({
          code: "custom",
          path: ["files"],
          message:
            "Only explicitly grouped ticket views share a processing identity",
        });
  });
export type EmailIntakeDecision = z.infer<typeof emailIntakeDecisionSchema>;

/** Bounded restoration of immutable private choices; not an email processing result. */
export const emailIntakeDecisionPageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(1024).optional(),
});
export const emailIntakeDecisionPageSchema = z.strictObject({
  storeId: id,
  ownerId: id,
  cursor: z.string().min(1).max(1024).nullable(),
  decisions: z.array(emailIntakeDecisionSchema).max(50),
  nextCursor: z.string().min(1).max(1024).nullable(),
});
export type EmailIntakeDecisionPage = z.infer<
  typeof emailIntakeDecisionPageSchema
>;
