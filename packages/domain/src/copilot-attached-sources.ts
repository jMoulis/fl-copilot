import { z } from "zod";
import { sourceTypeSchema } from "./source-documents";
/** Source identity/upload metadata only; this is not extracted content or official evidence. */
export const copilotAttachedSourceSchema = z
  .strictObject({
    sourceDocumentId: z.string().uuid(),
    status: z.enum(["CONFIRMED", "PENDING_UPLOAD", "UNAVAILABLE"]),
    sourceType: sourceTypeSchema.nullable(),
    filename: z.string().min(1).max(240).nullable(),
    mediaType: z.string().min(1).max(120).nullable(),
    registeredAt: z.string().datetime().nullable(),
  })
  .superRefine((value, ctx) => {
    const metadata = [
      value.sourceType,
      value.filename,
      value.mediaType,
      value.registeredAt,
    ];
    if (
      value.status === "UNAVAILABLE"
        ? metadata.some((field) => field !== null)
        : metadata.some((field) => field === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent source availability",
      });
  });
export const copilotAttachedSourcesSchema = z
  .array(copilotAttachedSourceSchema)
  .max(10)
  .refine(
    (values) =>
      new Set(values.map((value) => value.sourceDocumentId)).size ===
      values.length,
  );
