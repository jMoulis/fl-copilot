import { z } from "zod";
/** Device-local copy proof. Never included in a remote business payload. */
export const sourceOriginalCopySchema = z.strictObject({
  localUri: z
    .string()
    .min(8)
    .max(2048)
    .startsWith("file:///")
    .refine((value) => !value.includes("\0")),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
});
export const sourceOriginalRestorationSchema = z.strictObject({
  operationId: z.uuid(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  copy: sourceOriginalCopySchema,
});
export type SourceOriginalCopy = z.infer<typeof sourceOriginalCopySchema>;
export type SourceOriginalRestoration = z.infer<
  typeof sourceOriginalRestorationSchema
>;
