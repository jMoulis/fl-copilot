import { z } from "zod";
import { sourceOriginalDownloadSchema } from "./source-original";
const id = z.uuid(),
  time = z.iso.datetime();
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
          errorCode: z
            .enum([
              "UNSUPPORTED",
              "TOO_LARGE",
              "IDENTITY_CHANGED",
              "SCOPE_CHANGED",
              "PROVIDER_UNAVAILABLE",
              "STORAGE_UNAVAILABLE",
              "READ_FAILED",
            ])
            .optional(),
        }),
      )
      .max(50),
  })
  .superRefine((value, ctx) => {
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
