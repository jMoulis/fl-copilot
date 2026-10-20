import { z } from "zod";
import type { ClientSession, Db } from "mongodb";
/** This application's receiving-download reservations, per UTC day. No email date or
 * sender-controlled value chooses the budget window. These are not provider billing totals. */
export const EMAIL_DOWNLOAD_DAILY_LIMITS = {
  application: { bytes: 1024 * 1024 * 1024, downloads: 1000 },
  owner: { bytes: 512 * 1024 * 1024, downloads: 500 },
} as const;
export const EMAIL_DOWNLOAD_DAILY_LIMIT = "EMAIL_INTAKE_DAILY_LIMIT";
export function nextEmailBudgetDay(timestamp: Date) {
  return new Date(
    Date.UTC(
      timestamp.getUTCFullYear(),
      timestamp.getUTCMonth(),
      timestamp.getUTCDate() + 1,
    ),
  );
}
/** Must share the live job's transaction: either both counters reserve or neither does.
 * Reservations remain charged after a failed/aborted download (conservative cost bound). */
export async function reserveEmailDownload(
  db: Db,
  session: ClientSession,
  ownerId: string,
  bytes: number,
  timestamp: Date,
) {
  z.uuid().parse(ownerId);
  z.number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .parse(bytes);
  const day = timestamp.toISOString().slice(0, 10);
  const counters = db.collection<{
    _id: string;
    day: string;
    ownerId: string | null;
    bytes: number;
    downloads: number;
  }>("emailIntakeDailyUsage");
  for (const [key, owner, limits] of [
    [`application:${day}`, null, EMAIL_DOWNLOAD_DAILY_LIMITS.application],
    [`owner:${ownerId}:${day}`, ownerId, EMAIL_DOWNLOAD_DAILY_LIMITS.owner],
  ] as const) {
    await counters.updateOne(
      { _id: key },
      { $setOnInsert: { day, ownerId: owner, bytes: 0, downloads: 0 } },
      { upsert: true, session },
    );
    const result = await counters.updateOne(
      {
        _id: key,
        day,
        ownerId: owner,
        bytes: { $lte: limits.bytes - bytes },
        downloads: { $lt: limits.downloads },
      },
      { $inc: { bytes, downloads: 1 } },
      { session },
    );
    if (result.matchedCount !== 1) throw Error(EMAIL_DOWNLOAD_DAILY_LIMIT);
  }
}
