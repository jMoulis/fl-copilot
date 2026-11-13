import { z } from "zod";
import { parisDate, weeklyContextSchema } from "./weekly-context";

/** Internal source archive, not a syncable business entity. Capture date is not
 * the observation/publication date of the data contained in these weeks. */
export const dailyJournalContextSchema = z
  .strictObject({
    version: z.literal(1),
    storeId: z.uuid(),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    date: z.iso.date(),
    firstCollectedAt: z.iso.datetime(),
    lastCollectedAt: z.iso.datetime(),
    contexts: z.array(weeklyContextSchema).min(1).max(3),
  })
  .superRefine((entry, ctx) => {
    if (
      entry.firstCollectedAt > entry.lastCollectedAt ||
      parisDate(entry.firstCollectedAt) !== entry.date ||
      parisDate(entry.lastCollectedAt) !== entry.date ||
      entry.contexts.some((c) => c.storeId !== entry.storeId) ||
      new Set(entry.contexts.map((c) => c.weekStart)).size !==
        entry.contexts.length
    )
      ctx.addIssue({ code: "custom", message: "Invalid daily context scope" });
  });
export type DailyJournalContext = z.infer<typeof dailyJournalContextSchema>;
