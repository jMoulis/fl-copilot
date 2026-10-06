import { randomUUID } from "node:crypto";
import { Long } from "mongodb";
import {
  SYNC_PROTOCOL_VERSION,
  type BootstrapQuery,
  type BootstrapResponse,
} from "@fl-copilot/sync-contracts";
import type { AuthorizedStoreContext } from "../auth/service.js";
import type { DatabaseService } from "../database/types.js";
import { encodeSyncCursor } from "./pull-service.js";
import {
  serializeSyncTestEntity,
  type SyncTestEntityDocument,
} from "./sync-test-entity.js";
import {
  serializeProductAliasDocument,
  serializeProductDocument,
  serializeProductIdentifierDocument,
  type ProductAliasDocument,
  type ProductDocument,
  type ProductIdentifierDocument,
} from "../products/product-master.js";

interface SyncStoreCounterDocument {
  _id: string;
  nextSequence: Long;
}

export interface SyncBootstrapService {
  bootstrap(
    store: AuthorizedStoreContext,
    query: BootstrapQuery,
  ): Promise<BootstrapResponse>;
}

export function createMongoSyncBootstrapService(
  database: DatabaseService,
  now: () => Date = () => new Date(),
  generateRevision: () => string = randomUUID,
): SyncBootstrapService {
  return {
    async bootstrap(store, query) {
      const mongoDatabase = await database.getDb();
      const session = mongoDatabase.client.startSession();
      let response: BootstrapResponse | undefined;

      try {
        await session.withTransaction(
          async () => {
            const counter = await mongoDatabase
              .collection<SyncStoreCounterDocument>("syncStoreCounters")
              .findOne(
                { _id: store.storeId },
                { session, promoteLongs: false },
              );
            const [
              syncTestEntities,
              products,
              productIdentifiers,
              productAliases,
            ] = await Promise.all([
              mongoDatabase
                .collection<SyncTestEntityDocument>("syncTestEntities")
                .find({ storeId: store.storeId }, { session })
                .sort({ _id: 1 })
                .toArray(),
              mongoDatabase
                .collection<ProductDocument>("products")
                .find({ storeId: store.storeId, deletedAt: null }, { session })
                .sort({ _id: 1 })
                .toArray(),
              mongoDatabase
                .collection<ProductIdentifierDocument>("productIdentifiers")
                .find({ storeId: store.storeId, deletedAt: null }, { session })
                .sort({ _id: 1 })
                .toArray(),
              mongoDatabase
                .collection<ProductAliasDocument>("productAliases")
                .find({ storeId: store.storeId, deletedAt: null }, { session })
                .sort({ _id: 1 })
                .toArray(),
            ]);
            const publications = await mongoDatabase
              .collection<
                import("../uploads/waste-receipt-publication.js").WastePublicationDocument
              >("wasteReceiptPublications")
              .find({ storeId: store.storeId }, { session })
              .toArray();
            const sequence = counter?.nextSequence ?? Long.ZERO;
            response = {
              protocolVersion: SYNC_PROTOCOL_VERSION,
              store: {
                id: store.storeId,
                name: store.storeName,
                role: store.role,
              },
              snapshotRevision: generateRevision(),
              cursor: encodeSyncCursor(store.storeId, sequence),
              historyPolicy: {
                rawObservationDays: query.rawObservationDays,
              },
              entities: {
                syncTestEntities: syncTestEntities.map(serializeSyncTestEntity),
                products: products.map(serializeProductDocument),
                productIdentifiers: productIdentifiers.map(
                  serializeProductIdentifierDocument,
                ),
                productAliases: productAliases.map(
                  serializeProductAliasDocument,
                ),
                needUnits: [],
                needMemberships: [],
                productSubstitutions: [],
                salesObservations: [],
                wasteObservations: [],
                wasteReceiptPublications: publications.map((p) => ({
                  id: p.id,
                  storeId: p.storeId,
                  remoteVersion: p.remoteVersion,
                  publication: p.publication,
                })),
                commercialOperations: [],
                offers: [],
                marketSignals: [],
                executionInstructions: [],
                storeEvents: [],
                productDailyPerformance: [],
                departmentDailyPerformance: [],
                recommendations: [],
                decisions: [],
                actionExecutions: [],
              },
              serverTime: now().toISOString(),
            };
          },
          { readConcern: { level: "snapshot" }, readPreference: "primary" },
        );
      } finally {
        await session.endSession();
      }

      if (!response) {
        throw new Error("Bootstrap snapshot transaction did not complete.");
      }
      return response;
    },
  };
}
