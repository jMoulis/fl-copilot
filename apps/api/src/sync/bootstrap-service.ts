import {
  serializeStoreContext,
  type StoreContextDocument,
} from "../store-context-sync.js";
import {
  serializeCommercialExecution,
  type ExecutionTaskDocument,
} from "../commercial/execution-sync.js";
import {
  serializeCommercialPlan,
  serializeCommercialPlanRevision,
  type WeekPlanDocument,
  type PlanRevisionDocument,
} from "../commercial/week-plan-sync.js";
import {
  serializeValidatedOffer,
  type ValidatedOfferDocument,
} from "../commercial/validated-offer-sync.js";
import {
  serializeCommercialVersionDecision,
  type VersionDecisionDocument,
} from "../commercial/version-decision-sync.js";
import {
  serializeCommercialPreparation,
  type PreparationDocument,
} from "../commercial/week-preparation-sync.js";
import {
  serializeCommercialChoice,
  type OfferChoiceDocument,
} from "../commercial/offer-choice-sync.js";
import {
  serializeVisualReading,
  type VisualReadingDocument,
} from "../commercial/visual-reading-store.js";
import {
  registerCommercialReviewPages,
  serializeCommercialReviewPage,
  serializeCommercialReviewDecision,
  type ReviewPageDocument,
  type ReviewDecisionDocument,
} from "../commercial/review-sync.js";
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
      if (query.commercialReview === "true")
        await registerCommercialReviewPages(database, store.storeId);
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
            const reviewPages =
              query.commercialReview === "true"
                ? await mongoDatabase
                    .collection<ReviewPageDocument>("commercialReviewPages")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const reviewDecisions =
              query.commercialReview === "true"
                ? await mongoDatabase
                    .collection<ReviewDecisionDocument>(
                      "commercialReviewDecisions",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const visuals =
              query.commercialVisual === "true"
                ? await mongoDatabase
                    .collection<VisualReadingDocument>(
                      "commercialVisualReadings",
                    )
                    .find(
                      {
                        storeId: store.storeId,
                        status: { $in: ["READY", "FAILED"] },
                      },
                      { session },
                    )
                    .toArray()
                : [];
            const choices =
              query.commercialChoices === "true"
                ? await mongoDatabase
                    .collection<OfferChoiceDocument>("commercialOfferChoices")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const weekPlans =
              query.commercialPlans === "true"
                ? await mongoDatabase
                    .collection<WeekPlanDocument>("commercialWeekPlans")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const planRevisions =
              query.commercialPlans === "true"
                ? await mongoDatabase
                    .collection<PlanRevisionDocument>("commercialPlanRevisions")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const validatedOffers =
              query.commercialValidation === "true"
                ? await mongoDatabase
                    .collection<ValidatedOfferDocument>(
                      "commercialValidatedOffers",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const versionDecisions =
              query.commercialVersions === "true"
                ? await mongoDatabase
                    .collection<VersionDecisionDocument>(
                      "commercialVersionDecisions",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const contextSettings =
              query.storeContext === "true"
                ? await mongoDatabase
                    .collection<StoreContextDocument>("storeContextSettings")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const executionTasks =
              query.commercialExecution === "true"
                ? await mongoDatabase
                    .collection<ExecutionTaskDocument>(
                      "commercialExecutionTasks",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const preparations =
              query.commercialPreparation === "true"
                ? await mongoDatabase
                    .collection<PreparationDocument>(
                      "commercialWeekPreparations",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
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
                ...(query.commercialReview === "true"
                  ? {
                      commercialReviewPages: reviewPages.map(
                        serializeCommercialReviewPage,
                      ),
                      commercialReviewDecisions: reviewDecisions.map(
                        serializeCommercialReviewDecision,
                      ),
                    }
                  : {}),
                ...(query.commercialVisual === "true"
                  ? {
                      commercialVisualReadings: visuals.map(
                        serializeVisualReading,
                      ),
                    }
                  : {}),
                ...(query.commercialChoices === "true"
                  ? {
                      commercialOfferChoices: choices.map(
                        serializeCommercialChoice,
                      ),
                    }
                  : {}),
                ...(query.commercialPlans === "true"
                  ? {
                      commercialWeekPlans: weekPlans.map(
                        serializeCommercialPlan,
                      ),
                    }
                  : {}),
                ...(query.commercialPlans === "true"
                  ? {
                      commercialPlanRevisions: planRevisions.map(
                        serializeCommercialPlanRevision,
                      ),
                    }
                  : {}),
                ...(query.commercialValidation === "true"
                  ? {
                      commercialValidatedOffers: validatedOffers.map(
                        serializeValidatedOffer,
                      ),
                    }
                  : {}),
                ...(query.commercialVersions === "true"
                  ? {
                      commercialVersionDecisions: versionDecisions.map(
                        serializeCommercialVersionDecision,
                      ),
                    }
                  : {}),
                ...(query.storeContext === "true"
                  ? {
                      storeContextSettings: contextSettings.map(
                        serializeStoreContext,
                      ),
                    }
                  : {}),
                ...(query.commercialExecution === "true"
                  ? {
                      commercialExecutionTasks: executionTasks.map(
                        serializeCommercialExecution,
                      ),
                    }
                  : {}),
                ...(query.commercialPreparation === "true"
                  ? {
                      commercialWeekPreparations: preparations.map(
                        serializeCommercialPreparation,
                      ),
                    }
                  : {}),
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
