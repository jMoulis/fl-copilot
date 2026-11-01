import { COMMERCIAL_VISUAL_SCHEMA_VERSION } from "@fl-copilot/domain";
import type { Db } from "mongodb";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
/** Select one coherent completed generation, keeping prior results during a rerun.
 * Historical references continue to load their immutable reading IDs directly. */
export async function readCurrentCommercialVisualPages(
  db: Db,
  storeId: string,
  sourceDocumentId: string,
  checksum: string,
) {
  const collection = db.collection<
    import("mongodb").Document & { _id: string }
  >("commercialVisualReadings");
  const filter = {
    storeId,
    sourceDocumentId,
    schemaVersion: COMMERCIAL_VISUAL_SCHEMA_VERSION,
    checksum,
    status: { $in: ["READY", "FAILED"] },
  };
  const revision = await collection
    .aggregate<{
      _id: number;
      ids: string[];
      count: number;
      ready: number;
      total: number;
    }>(
      [
        { $match: filter },
        { $sort: { updatedAt: -1, _id: -1 } },
        {
          $group: {
            _id: {
              revision: { $ifNull: ["$analysisRevision", 0] },
              page: "$pageNumber",
            },
            reading: { $first: "$$ROOT" },
          },
        },
        { $replaceRoot: { newRoot: "$reading" } },
        {
          $group: {
            _id: { $ifNull: ["$analysisRevision", 0] },
            ids: { $push: "$_id" },
            count: { $sum: 1 },
            ready: { $sum: { $cond: [{ $eq: ["$status", "READY"] }, 1, 0] } },
            total: { $max: "$pageCount" },
          },
        },
        {
          $addFields: {
            complete: {
              $and: [
                { $eq: ["$count", "$total"] },
                { $eq: ["$ready", "$total"] },
              ],
            },
          },
        },
        {
          $addFields: {
            revisionOrder: {
              $cond: ["$complete", { $multiply: ["$_id", -1] }, "$_id"],
            },
          },
        },
        { $sort: { complete: -1, revisionOrder: 1 } },
        { $limit: 1 },
      ],
      { maxTimeMS: 2000 },
    )
    .next();
  if (!revision) return [];
  return (
    await collection
      .find({ ...filter, _id: { $in: revision.ids } })
      .sort({ pageNumber: 1 })
      .limit(101)
      .maxTimeMS(2000)
      .toArray()
  ).map((row) => {
    const page = synchronizedCommercialVisualReadingSchema.parse(row);
    if (
      page.id !== row._id ||
      page.storeId !== storeId ||
      page.sourceDocumentId !== sourceDocumentId
    )
      throw Error("COMMERCIAL_READING_SCOPE_INVALID");
    return page;
  });
}
