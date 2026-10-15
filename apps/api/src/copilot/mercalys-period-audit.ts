import type { Db } from "mongodb";
import { z } from "zod";
const countsSchema = z.object({
  files: z.number().int().nonnegative(),
  publishedRows: z.number().int().nonnegative(),
  reviewRows: z.number().int().nonnegative(),
});
/** Audit the already synchronized approval graphs. Superseded sources with no active rows do not create review work. */
export async function readMercalysPeriodAudit(
  db: Db,
  storeId: string,
  period: { start: string; end: string },
  flow: "MERCALYS_SALES" | "MERCALYS_WASTE",
) {
  const rowsPath =
    flow === "MERCALYS_SALES" ? "$publication.sales" : "$publication.waste";
  const inPeriod = (key: string) => ({
    $and: [{ $gte: [key, period.start] }, { $lte: [key, period.end] }],
  });
  const rows = await db
    .collection("mercalysPublications")
    .aggregate(
      [
        { $match: { storeId, "publication.source.sourceType": flow } },
        {
          $project: {
            active: {
              $filter: {
                input: rowsPath,
                as: "r",
                cond: {
                  $and: [
                    { $eq: ["$$r.deletedAt", null] },
                    inPeriod("$$r.businessDate"),
                  ],
                },
              },
            },
            review: {
              $filter: {
                input: "$publication.records",
                as: "r",
                cond: {
                  $and: [
                    {
                      $in: ["$$r.status", ["WARNING", "ERROR", "VALID"]],
                    },
                    inPeriod("$$r.normalizedPayload.businessDate"),
                  ],
                },
              },
            },
          },
        },
        { $match: { "active.0": { $exists: true } } },
        {
          $group: {
            _id: null,
            files: { $sum: 1 },
            publishedRows: { $sum: { $size: "$active" } },
            reviewRows: { $sum: { $size: "$review" } },
          },
        },
      ],
      { maxTimeMS: 2000 },
    )
    .toArray();
  return countsSchema.parse(
    rows[0] ?? { files: 0, publishedRows: 0, reviewRows: 0 },
  );
}
