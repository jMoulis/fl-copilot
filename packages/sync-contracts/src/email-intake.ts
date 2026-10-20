import { z } from "zod";
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
