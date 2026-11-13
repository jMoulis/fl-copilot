import type { Inngest } from "inngest";
import { z } from "zod";
import type { DatabaseService } from "../database/types.js";
import type { WeekContextService } from "./week-context.js";
import { collectDailyJournal } from "./daily-journal.js";

export const journalCollectionSchedule = "TZ=Europe/Paris 15 7,13,20 * * *";
const input = z.strictObject({ storeId: z.uuid() });

/** Reuse the existing signed Inngest endpoint, retries and monitoring. Scheduler
 * output contains identities/counts only, never source payloads or API keys. */
export function createJournalWorkflows(
  client: Inngest,
  database: DatabaseService,
  live: WeekContextService,
) {
  const collect = client.createFunction(
    {
      id: "journal-collect-store-day-v1",
      concurrency: [{ limit: 1, key: "event.data.storeId" }, { limit: 2 }],
      retries: 2,
      triggers: [{ event: "journal/store.collect" }],
    },
    async ({ event, step }) => {
      const { storeId } = input.parse(event.data);
      return step.run("collect-public-context-without-ai", () =>
        collectDailyJournal(database, live, storeId),
      );
    },
  );
  const schedule = client.createFunction(
    {
      id: "journal-collect-schedule-v1",
      concurrency: 1,
      retries: 2,
      triggers: [{ cron: journalCollectionSchedule }],
    },
    async ({ step }) => {
      let cursor = "",
        total = 0;
      for (let page = 0; ; page++) {
        const after = cursor;
        const batch = await step.run(`stores-${page}`, async () => {
          const db = await database.getDb();
          const rows = await db
            .collection("storeContextSettings")
            .find({
              storeId: { $type: "string", ...(after ? { $gt: after } : {}) },
            })
            .project({ _id: 0, storeId: 1 })
            .sort({ storeId: 1 })
            .limit(100)
            .toArray();
          return {
            ids: rows.flatMap((r) =>
              z.uuid().safeParse(r.storeId).success ? [String(r.storeId)] : [],
            ),
            count: rows.length,
            cursor: String(rows.at(-1)?.storeId ?? ""),
          };
        });
        if (!batch.count) break;
        if (batch.ids.length)
          await step.sendEvent(
            `dispatch-${page}`,
            batch.ids.map((storeId) => ({
              name: "journal/store.collect",
              data: { storeId },
            })),
          );
        total += batch.ids.length;
        cursor = batch.cursor;
        if (batch.count < 100) break;
      }
      return { stores: total };
    },
  );
  return [schedule, collect];
}
