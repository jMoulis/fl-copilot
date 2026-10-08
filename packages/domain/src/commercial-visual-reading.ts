import { z } from "zod";
import { commercialFieldNameSchema } from "./commercial-ai-drafts";
export const COMMERCIAL_VISUAL_SCHEMA_VERSION = "commercial-visual.v1";
export const commercialVisualEvidenceSchema = z
  .object({
    pageNumber: z.number().int().min(1).max(100),
    quote: z.string().trim().min(1).max(1200),
    region: z
      .object({
        left: z.number().min(0).max(1),
        top: z.number().min(0).max(1),
        right: z.number().min(0).max(1),
        bottom: z.number().min(0).max(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const commercialVisualFieldSchema = z
  .object({
    name: z.union([
      commercialFieldNameSchema,
      z.enum([
        "variety",
        "origin",
        "grade",
        "calibre",
        "packaging",
        "announcedFigure",
        "documentYear",
      ]),
    ]),
    rawValue: z.string().trim().min(1).max(2000).nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(commercialVisualEvidenceSchema).max(8),
  })
  .strict();
export const commercialVisualItemSchema = z
  .object({
    kind: z.enum([
      "OFFER",
      "INSTRUCTION",
      "COMMUNICATION",
      "WINDOW",
      "MERCHANDISING",
      "ANNOUNCED_FIGURE",
    ]),
    label: z.string().trim().min(1).max(240),
    fields: z.array(commercialVisualFieldSchema).max(30),
    evidence: z.array(commercialVisualEvidenceSchema).min(1).max(8),
  })
  .strict();
export const commercialVisualOperationSchema = z
  .object({
    kind: z.enum(["DRAMAT", "PROSPECTUS", "BASIC", "OTHER"]),
    label: z.string().trim().min(1).max(240),
    summaryFr: z.string().trim().min(1).max(1200),
    fields: z.array(commercialVisualFieldSchema).max(30),
    evidence: z.array(commercialVisualEvidenceSchema).min(1).max(8),
    items: z.array(commercialVisualItemSchema).max(60),
  })
  .strict();
export const commercialVisualPageOutputSchema = z
  .object({
    operations: z.array(commercialVisualOperationSchema).max(30),
    tgIdeas: z.array(commercialVisualItemSchema).max(20),
    otherInformation: z.array(commercialVisualItemSchema).max(40),
    warnings: z.array(z.string().trim().min(1).max(400)).max(30),
  })
  .strict();
export type CommercialVisualPageOutput = z.infer<
  typeof commercialVisualPageOutputSchema
>;
export type CommercialVisualEvidence = z.infer<
  typeof commercialVisualEvidenceSchema
>;
