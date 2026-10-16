import { z } from "zod";
/** Screening is defense in depth; never pass canonical/private store context to this tool. */
export function isPublicResearchUrl(raw: string) {
  if (!z.url().safeParse(raw).success) return false;
  const h = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(raw)?.[1]?.toLowerCase();
  if (
    !h ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(h)
  )
    return false;
  if (
    /(?:^|\.)(?:localhost|local|localdomain|internal|test|invalid)$/.test(h) ||
    h.endsWith(".blob.vercel-storage.com") ||
    h === "fl-copilot.vercel.app"
  )
    return false;
  try {
    return !/[?&#][^=&#]*(?:token|secret|signature|credential|password|authorization)[^=&#]*(?:=|&|#|$)/i.test(
      decodeURIComponent(raw),
    );
  } catch {
    return false;
  }
}
export const publicResearchQuerySchema = z
  .string()
  .trim()
  .min(3)
  .max(1600)
  .refine((q) => {
    if (
      /\b(?:sk-|re_|Bearer\s|mongodb(?:\+srv)?:|file:|localhost)|[^\s@]+@[^\s@]+\.[^\s@]+|\b(?:password|api[_-]?key|access[_-]?token)\s*[:=]/i.test(
        q,
      )
    )
      return false;
    return (q.match(/https?:\/\/[^\s]+/g) ?? []).every(isPublicResearchUrl);
  });
export const publicWebResearchRequestSchema = z.strictObject({
  requestId: z.string().uuid(),
  query: publicResearchQuerySchema,
  purpose: z.enum([
    "PRODUCE",
    "SHOPPER",
    "MERCHANDISING",
    "MARKET",
    "CALENDAR",
  ]),
});
export const publicWebResearchResultSchema = z
  .strictObject({
    requestId: z.string().uuid(),
    query: publicResearchQuerySchema,
    purpose: z.enum([
      "PRODUCE",
      "SHOPPER",
      "MERCHANDISING",
      "MARKET",
      "CALENDAR",
    ]),
    kind: z.literal("EXTERNAL_RESEARCH"),
    summaryFr: z
      .string()
      .min(1)
      .max(6000)
      .refine((v) => v.trim().length > 0),
    accessedAt: z.string().datetime(),
    citations: z
      .array(
        z.strictObject({
          url: z.string().refine(isPublicResearchUrl),
          title: z.string().min(1).max(400),
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
          publishedAt: z.null(),
        }),
      )
      .min(1)
      .max(20),
    model: z.string().min(1).max(200),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  })
  .superRefine((r, c) => {
    for (const citation of r.citations)
      if (citation.end <= citation.start || citation.end > r.summaryFr.length)
        c.addIssue({ code: "custom", message: "Invalid citation range" });
  });
export type PublicWebResearchRequest = z.infer<
  typeof publicWebResearchRequestSchema
>;
export type PublicWebResearchResult = z.infer<
  typeof publicWebResearchResultSchema
>;

/** Model may supply only a general public topic, never private identifiers or metrics. */
export const copilotPublicResearchInputSchema = z.strictObject({
  query: publicResearchQuerySchema.refine(
    (q) =>
      q.length <= 400 &&
      !/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\d{8,}|[€$%]|\b(?:mon|ma|mes|notre|nos|my|our)\b/i.test(
        q,
      ),
  ),
  purpose: publicWebResearchRequestSchema.shape.purpose,
});
export const copilotExternalResearchSourceSchema = z
  .strictObject({
    kind: z.literal("EXTERNAL_RESEARCH"),
    accessedAt: z.string().datetime(),
    citations: z
      .array(
        z.strictObject({
          url: z.string().max(600).refine(isPublicResearchUrl),
          title: z.string().min(1).max(120),
          publishedAt: z.null(),
        }),
      )
      .min(1)
      .max(3),
  })
  .refine((v) => {
    try {
      return encodeURIComponent(JSON.stringify(v)).length <= 3500;
    } catch {
      return false;
    }
  });
