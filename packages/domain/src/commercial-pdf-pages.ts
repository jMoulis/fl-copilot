import { z } from "zod";
export const commercialPdfTextSpanSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  transform: z.array(z.number().finite()).length(6),
  width: z.number().finite(),
  height: z.number().finite(),
  direction: z.enum(["ltr", "rtl", "ttb"]),
  hasEndOfLine: z.boolean(),
});
export const commercialPdfPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(100),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  rotation: z.number().int(),
  text: z.string().max(200_000),
  spans: z.array(commercialPdfTextSpanSchema).max(20_000),
  warnings: z.array(z.literal("NO_EXTRACTABLE_TEXT")),
});
export type CommercialPdfPage = z.infer<typeof commercialPdfPageSchema>;
