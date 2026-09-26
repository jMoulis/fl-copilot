import { Long } from "mongodb";
import { z } from "zod";
import type {
  SyncChangeEnvelope,
  SyncPullQuery,
  SyncPullResponse,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types.js";
import type { SyncChangeDocument } from "./sync-change-service.js";
import {
  serializeSyncTestEntity,
  type SyncTestEntityDocument,
} from "./sync-test-entity.js";
import {
  serializeProductMasterDocument,
  type ProductAliasDocument,
  type ProductDocument,
  type ProductIdentifierDocument,
} from "../products/product-master.js";

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  storeId: z.string().uuid(),
  sequence: z.string().regex(/^\d+$/),
});

export class SyncPullCursorError extends Error {
  constructor() {
    super("Invalid synchronization cursor.");
    this.name = "SyncPullCursorError";
  }
}

export interface SyncPullService {
  pull(storeId: string, query: SyncPullQuery): Promise<SyncPullResponse>;
}

export function createMongoSyncPullService(
  database: DatabaseService,
  now: () => Date = () => new Date(),
): SyncPullService {
  return {
    async pull(storeId, query) {
      const afterSequence = query.cursor
        ? decodeCursor(query.cursor, storeId)
        : Long.ZERO;
      const mongoDatabase = await database.getDb();
      const page = await mongoDatabase
        .collection<SyncChangeDocument>("syncChanges")
        .find(
          { storeId, sequence: { $gt: afterSequence } },
          { promoteLongs: false },
        )
        .sort({ sequence: 1 })
        .limit(query.limit + 1)
        .toArray();
      const hasMore = page.length > query.limit;
      const selected = hasMore ? page.slice(0, query.limit) : page;
      const entities = await loadSyncTestEntities(
        mongoDatabase,
        storeId,
        selected,
      );
      const productEntities = await loadProductMasterEntities(
        mongoDatabase,
        storeId,
        selected,
      );
      const changes = selected.map((change) =>
        toEnvelope(change, entities, productEntities),
      );
      const nextSequence = selected.at(-1)?.sequence ?? afterSequence;

      return {
        changes,
        nextCursor: encodeSyncCursor(storeId, nextSequence),
        hasMore,
        serverTime: now().toISOString(),
      };
    },
  };
}

export function encodeSyncCursor(storeId: string, sequence: Long) {
  return Buffer.from(
    JSON.stringify({ version: 1, storeId, sequence: sequence.toString() }),
  ).toString("base64url");
}

function decodeCursor(cursor: string, storeId: string) {
  try {
    const payload = cursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    if (payload.storeId !== storeId) throw new SyncPullCursorError();
    const sequence = Long.fromString(payload.sequence);
    if (sequence.isNegative()) throw new SyncPullCursorError();
    return sequence;
  } catch (error) {
    if (error instanceof SyncPullCursorError) throw error;
    throw new SyncPullCursorError();
  }
}

async function loadSyncTestEntities(
  database: Awaited<ReturnType<DatabaseService["getDb"]>>,
  storeId: string,
  changes: SyncChangeDocument[],
) {
  const ids = changes
    .filter(
      (change) =>
        change.operation === "UPSERT" &&
        change.entityType === "sync_test_entity",
    )
    .map((change) => change.entityId);
  if (ids.length === 0) return new Map<string, SyncTestEntityDocument>();
  const entities = await database
    .collection<SyncTestEntityDocument>("syncTestEntities")
    .find({ _id: { $in: ids }, storeId })
    .toArray();
  return new Map(entities.map((entity) => [entity._id, entity]));
}

function toEnvelope(
  change: SyncChangeDocument,
  syncTestEntities: Map<string, SyncTestEntityDocument>,
  productEntities: Map<
    string,
    ProductDocument | ProductIdentifierDocument | ProductAliasDocument
  >,
): SyncChangeEnvelope {
  if (change.operation === "DELETE") {
    return {
      sequence: change.sequence.toString(),
      entityType: change.entityType,
      entityId: change.entityId,
      operation: change.operation,
      entityVersion: change.entityVersion,
      changedAt: change.changedAt.toISOString(),
    };
  }
  if (change.entityType !== "sync_test_entity") {
    const entity = productEntities.get(
      `${change.entityType}:${change.entityId}`,
    );
    if (!entity) {
      throw new Error(`Synchronized entity is missing: ${change.entityId}`);
    }
    return {
      sequence: change.sequence.toString(),
      entityType: change.entityType,
      entityId: change.entityId,
      operation: change.operation,
      entityVersion: entity.version,
      entity: serializeProductMasterDocument(change.entityType, entity),
      changedAt: change.changedAt.toISOString(),
    };
  }
  const entity = syncTestEntities.get(change.entityId);
  if (!entity) {
    throw new Error(`Synchronized entity is missing: ${change.entityId}`);
  }
  return {
    sequence: change.sequence.toString(),
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    entityVersion: entity.version,
    entity: serializeSyncTestEntity(entity),
    changedAt: change.changedAt.toISOString(),
  };
}

async function loadProductMasterEntities(
  database: Awaited<ReturnType<DatabaseService["getDb"]>>,
  storeId: string,
  changes: SyncChangeDocument[],
) {
  const idsFor = (entityType: string) =>
    changes
      .filter(
        (change) =>
          change.operation === "UPSERT" && change.entityType === entityType,
      )
      .map((change) => change.entityId);
  const productIds = idsFor("product");
  const identifierIds = idsFor("product_identifier");
  const aliasIds = idsFor("product_alias");
  const [products, identifiers, aliases] = await Promise.all([
    productIds.length
      ? database
          .collection<ProductDocument>("products")
          .find({ _id: { $in: productIds }, storeId })
          .toArray()
      : [],
    identifierIds.length
      ? database
          .collection<ProductIdentifierDocument>("productIdentifiers")
          .find({ _id: { $in: identifierIds }, storeId })
          .toArray()
      : [],
    aliasIds.length
      ? database
          .collection<ProductAliasDocument>("productAliases")
          .find({ _id: { $in: aliasIds }, storeId })
          .toArray()
      : [],
  ]);
  const entities = new Map<
    string,
    ProductDocument | ProductIdentifierDocument | ProductAliasDocument
  >();
  for (const entity of products) entities.set(`product:${entity._id}`, entity);
  for (const entity of identifiers) {
    entities.set(`product_identifier:${entity._id}`, entity);
  }
  for (const entity of aliases) {
    entities.set(`product_alias:${entity._id}`, entity);
  }
  return entities;
}
