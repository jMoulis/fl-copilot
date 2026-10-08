import { z } from "zod";
export const commercialOriginalLinkSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://")),
  expiresAt: z.string().datetime(),
  filename: z.string(),
});
export type CommercialOriginalLink = z.infer<
  typeof commercialOriginalLinkSchema
>;
