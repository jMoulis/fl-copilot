import { createHash } from "node:crypto";
import { Decimal128, type Document } from "mongodb";
import {
  mercalysPublicationSchema,
  synchronizedMercalysPublicationSchema,
  type SyncCommand,
  type SynchronizedMercalysPublication,
} from "@fl-copilot/sync-contracts";
import {
  canonicalMercalysRecords,
  parseMercalysSales,
  parseMercalysWaste,
  SheetJsSpreadsheetParser,
  type ParsedMercalysArticleRecord,
} from "@fl-copilot/import-core";
import {
  createVercelPrivateSourceReader,
  type PrivateSourceReader,
} from "./import-verification-service.js";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service.js";
import type { createMongoSyncChangeService } from "../sync/sync-change-service.js";
export type MercalysPublicationDocument = SynchronizedMercalysPublication & {
  _id: string;
  version: number;
};
export async function applyMercalysPublicationCommand(
  context: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
  reader: PrivateSourceReader = createVercelPrivateSourceReader(),
): Promise<CommandMutationResult> {
  const rejected = (code: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: {
      error: {
        code,
        messageFr:
          "Les lignes Mercalys ne correspondent pas à leur source vérifiée. Le fichier local est conservé.",
        retryable: false,
        requestId,
      },
    },
  });
  const parsed = mercalysPublicationSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    command.entityType !== "mercalys_publication" ||
    parsed.data.source.id !== command.entityId ||
    parsed.data.source.storeId !== storeId
  )
    return rejected("MERCALYS_PUBLICATION_INVALID");
  const p = parsed.data,
    collection = context.database.collection<MercalysPublicationDocument>(
      "mercalysPublications",
    ),
    options = { session: context.session };
  const existing = await collection.findOne({ _id: command.entityId }, options);
  if (existing && existing.storeId !== storeId)
    return rejected("SYNC_ENTITY_STORE_MISMATCH");
  if (existing && JSON.stringify(existing.publication) === JSON.stringify(p))
    return {
      resultStatus: "APPLIED",
      resultingVersion: existing.version,
      responseJson: {
        remoteEntity: synchronizedMercalysPublicationSchema.parse(existing),
      },
    };
  if ((existing?.version ?? null) !== (command.expectedRemoteVersion ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: existing?.version ?? null,
      responseJson: {
        ...(existing
          ? {
              remoteEntity:
                synchronizedMercalysPublicationSchema.parse(existing),
            }
          : {}),
        error: {
          code: "MERCALYS_PUBLICATION_VERSION_CONFLICT",
          messageFr:
            "Cet import a une autre version synchronisée. Vos lignes locales sont conservées.",
          retryable: false,
          requestId,
        },
      },
    };
  const source = await context.database
    .collection<Document & { _id: string }>("sourceDocuments")
    .findOne(
      {
        _id: p.source.id,
        storeId,
        sourceType: p.source.sourceType,
        checksum: p.source.checksum,
        remoteUploadStatus: "CONFIRMED",
      },
      options,
    );
  if (!source || source.verificationStatus !== "MATCH")
    throw Error("MERCALYS_SOURCE_PENDING");
  // Compare with the actual immutable original, not the non-cryptographic parity fingerprint.
  const bytes = await reader.read(String(source.objectKey));
  if (!bytes) throw Error("MERCALYS_SOURCE_UNAVAILABLE");
  if (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
    p.source.checksum
  )
    return rejected("MERCALYS_SOURCE_CHECKSUM_INVALID");
  const workbook = new SheetJsSpreadsheetParser().parse(bytes),
    original =
      p.source.sourceType === "MERCALYS_SALES"
        ? parseMercalysSales(workbook)
        : parseMercalysWaste(workbook);
  const normalized = p.records.map(
    (r) => r.normalizedPayload as unknown as ParsedMercalysArticleRecord,
  );
  if (
    original.businessPeriodStart !== p.source.businessPeriodStart ||
    original.businessPeriodEnd !== p.source.businessPeriodEnd ||
    JSON.stringify(canonicalMercalysRecords(original.records)) !==
      JSON.stringify(canonicalMercalysRecords(normalized))
  )
    return rejected("MERCALYS_SOURCE_RECORDS_INVALID");
  const byIndex = new Map(original.records.map((r) => [r.sourceIndex, r]));
  for (const r of p.records) {
    const record =
      r.normalizedPayload as unknown as ParsedMercalysArticleRecord;
    if (
      !byIndex.has(r.sourceIndex ?? -1) ||
      JSON.stringify(
        canonicalMercalysRecords([byIndex.get(r.sourceIndex!)!]),
      ) !== JSON.stringify(canonicalMercalysRecords([record]))
    )
      return rejected("MERCALYS_SOURCE_RECORDS_INVALID");
  }
  if (
    existing &&
    JSON.stringify(existing.publication.source) !== JSON.stringify(p.source)
  )
    return rejected("MERCALYS_SOURCE_REVISION_INVALID");
  if (existing) {
    const byId = new Map(p.records.map((r) => [r.id, r]));
    for (const old of existing.publication.records) {
      const record = byId.get(old.id);
      if (
        !record ||
        record.sourceIndex !== old.sourceIndex ||
        record.version < old.version
      )
        return rejected("MERCALYS_SOURCE_REVISION_INVALID");
    }
  }
  const observations = [...p.sales, ...p.waste];
  const recordsById = new Map(p.records.map((r) => [r.id, r]));
  const products = await context.database
    .collection<Document & { _id: string }>("products")
    .find(
      {
        _id: { $in: [...new Set(observations.map((o) => o.productId))] },
        storeId,
      },
      options,
    )
    .project({ _id: 1 })
    .toArray();
  const productIds = new Set(products.map((v) => v._id));
  const oldObservations = new Map(
    existing
      ? [...existing.publication.sales, ...existing.publication.waste].map(
          (o) => [o.id, o],
        )
      : [],
  );
  for (const o of observations) {
    const r = recordsById.get(o.sourceRecordId)!,
      n = r.normalizedPayload as unknown as ParsedMercalysArticleRecord;
    const match = (r.normalizedPayload as Record<string, unknown>).match as
      { state?: string; matchedProductId?: string } | undefined;
    if (
      match?.state !== "AUTO_MATCH" ||
      match.matchedProductId !== o.productId ||
      o.businessDate !== n.businessDate ||
      !equalDecimal(o.quantity, n.quantity) ||
      !equalDecimal(o.salesValue, n.salesValue)
    )
      return rejected("MERCALYS_OBSERVATION_INVALID");
    if ("purchaseValue" in o) {
      for (const key of [
        "purchaseValue",
        "rceValue",
        "vatValue",
        "marginValue",
        "marginRate",
      ] as const)
        if (!equalDecimal(o[key], n[key]))
          return rejected("MERCALYS_OBSERVATION_INVALID");
    } else if (
      !equalDecimal(o.purchaseValueKnown, n.purchaseValue) ||
      o.costQuality !== (n.purchaseValue === null ? "UNAVAILABLE" : "KNOWN")
    )
      return rejected("MERCALYS_OBSERVATION_INVALID");
    if (!productIds.has(o.productId)) throw Error("MERCALYS_PRODUCT_PENDING");
    const old = oldObservations.get(o.id);
    if (
      old &&
      (old.sourceRecordId !== o.sourceRecordId ||
        old.productId !== o.productId ||
        old.businessDate !== o.businessDate ||
        o.version < old.version ||
        (old.deletedAt && !o.deletedAt))
    )
      return rejected("MERCALYS_OBSERVATION_REVISION_INVALID");
  }
  const active = observations.filter((o) => !o.deletedAt);
  if (active.length) {
    const table =
      p.source.sourceType === "MERCALYS_SALES"
        ? "salesObservations"
        : "wasteObservations";
    const overlap = await context.database
      .collection<Document & { _id: string }>(table)
      .findOne(
        {
          storeId,
          sourceDocumentId: { $ne: p.source.id },
          deletedAt: null,
          ...(table === "wasteObservations" ? { sourceType: "MERCALYS" } : {}),
          $or: active.map((o) => ({
            productId: o.productId,
            date: o.businessDate,
          })),
        },
        options,
      );
    if (overlap) throw Error("MERCALYS_REPLACEMENT_PENDING");
  }
  if (existing) {
    const next = new Map(observations.map((o) => [o.id, o]));
    for (const old of [
      ...existing.publication.sales,
      ...existing.publication.waste,
    ])
      if (!next.has(old.id))
        return rejected("MERCALYS_OBSERVATION_REMOVAL_INVALID");
  }
  for (const [table, rows] of [
    ["sourceRecords", p.records],
    ["salesObservations", p.sales],
    ["wasteObservations", p.waste],
  ] as const) {
    if (!rows.length) continue;
    const current = await context.database
      .collection<Document & { _id: string }>(table)
      .find({ _id: { $in: rows.map((r) => r.id) } }, options)
      .project({ storeId: 1, sourceDocumentId: 1 })
      .toArray();
    if (
      current.some(
        (r) => r.storeId !== storeId || r.sourceDocumentId !== p.source.id,
      )
    )
      return rejected("SYNC_ENTITY_STORE_MISMATCH");
  }
  const version = (existing?.version ?? 0) + 1;
  await context.database
    .collection<Document & { _id: string }>("sourceRecords")
    .bulkWrite(
      p.records.map((r) => ({
        replaceOne: {
          filter: { _id: r.id },
          replacement: { ...r, _id: r.id },
          upsert: true,
        },
      })),
      options,
    );
  for (const [table, rows] of [
    ["salesObservations", p.sales],
    ["wasteObservations", p.waste],
  ] as const) {
    if (rows.length)
      await context.database
        .collection<Document & { _id: string }>(table)
        .bulkWrite(
          rows.map((o) => ({
            replaceOne: {
              filter: { _id: o.id },
              replacement: toRemoteObservation(o),
              upsert: true,
            },
          })),
          options,
        );
  }
  const snapshot = synchronizedMercalysPublicationSchema.parse({
    id: p.source.id,
    storeId,
    remoteVersion: version,
    publication: p,
  });
  await collection.replaceOne(
    { _id: p.source.id },
    { ...snapshot, version },
    { ...options, upsert: true },
  );
  await context.database
    .collection<Document & { _id: string }>("sourceDocuments")
    .updateOne(
      { _id: p.source.id, storeId },
      {
        $set: {
          remoteProcessingStatus: "PUBLISHED",
          publishedObservationCount: observations.filter((o) => !o.deletedAt)
            .length,
        },
      },
      options,
    );
  await changes.append(context, {
    storeId,
    entityType: "mercalys_publication",
    entityId: p.source.id,
    operation: "UPSERT",
    entityVersion: version,
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: version,
    responseJson: { remoteEntity: snapshot },
  };
}
function equalDecimal(value: string | null, n: number | null) {
  return value === null ? n === null : n !== null && Number(value) === n;
}
function toRemoteObservation(o: Record<string, unknown>) {
  const { id, businessDate, ...rest } = o;
  const doc: Document & { _id: string } = {
    ...rest,
    _id: String(id),
    date: businessDate,
  };
  for (const key of [
    "quantity",
    "purchaseValue",
    "rceValue",
    "salesValue",
    "vatValue",
    "marginValue",
    "marginRate",
    "purchaseValueKnown",
    "purchaseValueEstimated",
  ])
    if (typeof doc[key] === "string")
      doc[key] = Decimal128.fromString(doc[key]);
  for (const key of ["createdAt", "updatedAt", "deletedAt"])
    if (typeof doc[key] === "string") doc[key] = new Date(doc[key]);
  return doc;
}
