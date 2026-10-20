import {
  serializeIllustrationGeneration,
  type IllustrationGenerationDocument,
} from "../copilot/layout-illustration-generation";
import {
  serializeLayoutIllustration,
  type LayoutIllustrationDocument,
} from "../copilot/layout-illustration-store";
import {
  visualCollections,
  serializeVisualEntity,
} from "../products/visual-library-sync";
import {
  legacyPhysicalPreparation,
  legacyPhysicalPlan,
  legacyPhysicalEntity,
} from "@fl-copilot/domain";
import {
  serializeStoreLayout,
  serializeStoreLayoutRevision,
  type StoreLayoutDocument,
  type StoreLayoutRevisionDocument,
} from "../store-layout-sync";
import {
  serializeActionExecution,
  type ActionExecutionDocument,
} from "../copilot/action-execution-store";
import { legacyCommercialExecution } from "@fl-copilot/domain";
import {
  serializeExecutionLink,
  type ExecutionLinkDocument,
} from "../copilot/execution-link-store";
import {
  serializeDecision,
  type DecisionDocument,
} from "../copilot/decision-store";
import {
  serializeKnowledge,
  type KnowledgeDocument,
} from "../copilot/knowledge-store";
import { chatBootstrap } from "../copilot/conversation-store";
import {
  serializeScoreHistory,
  type ScoreHistoryDocument,
} from "../substitution/score-store";
import {
  serializeSubstitutionEvidence,
  serializeSubstitutionEvidenceState,
  type SubstitutionEvidenceDocument,
} from "../substitution-evidence-sync";
import type { EvidenceStateDocument } from "../substitution-evidence-work";
import {
  serializeNeedMembership,
  type NeedMembershipDocument,
} from "../need-membership-sync";
import {
  serializeProductSubstitution,
  type ProductSubstitutionDocument,
} from "../product-substitution-sync";
import {
  serializeStoreProductEvent,
  type StoreProductEventDocument,
} from "../store-product-event-sync";
import { serializeNeedUnit, type NeedUnitDocument } from "../need-unit-sync";
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
    supportsHistoryDeletion?: boolean,
    supportsAnalyticsDestinations?: boolean,
  ): Promise<BootstrapResponse>;
}

export function createMongoSyncBootstrapService(
  database: DatabaseService,
  now: () => Date = () => new Date(),
  generateRevision: () => string = randomUUID,
): SyncBootstrapService {
  return {
    async bootstrap(
      store,
      query,
      supportsHistoryDeletion = false,
      supportsAnalyticsDestinations = false,
    ) {
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
            const visualEntities =
              query.visualLibrary === "true"
                ? {
                    visualLibrary: true,
                    visualAssets: (
                      await mongoDatabase
                        .collection(visualCollections.visual_asset)
                        .find({ storeId: store.storeId }, { session })
                        .toArray()
                    ).map((r) => serializeVisualEntity("visual_asset", r)),
                    visualIdentities: (
                      await mongoDatabase
                        .collection(visualCollections.visual_identity)
                        .find({ storeId: store.storeId }, { session })
                        .toArray()
                    ).map((r) => serializeVisualEntity("visual_identity", r)),
                    productVisualLinks: (
                      await mongoDatabase
                        .collection(visualCollections.product_visual_link)
                        .find({ storeId: store.storeId }, { session })
                        .toArray()
                    ).map((r) =>
                      serializeVisualEntity("product_visual_link", r),
                    ),
                  }
                : {};
            const actions =
              query.copilotActionExecutions === "true" &&
              query.copilotHistory === "true"
                ? await mongoDatabase
                    .collection<ActionExecutionDocument>("actionExecutions")
                    .find(
                      { storeId: store.storeId, ownerId: store.userId },
                      { session },
                    )
                    .limit(501)
                    .toArray()
                : null;
            if (actions && actions.length > 500)
              throw Error("COPILOT_ACTION_EXECUTION_LIMIT");
            const links =
              query.copilotExecutionLinks === "true" &&
              query.copilotHistory === "true"
                ? await mongoDatabase
                    .collection<ExecutionLinkDocument>("copilotExecutionLinks")
                    .find(
                      { storeId: store.storeId, ownerId: store.userId },
                      { session },
                    )
                    .limit(501)
                    .toArray()
                : null;
            if (links && links.length > 500)
              throw Error("COPILOT_EXECUTION_LINK_LIMIT");
            const illustrations =
              query.layoutIllustrations === "true" &&
              query.copilotHistory === "true"
                ? await mongoDatabase
                    .collection<LayoutIllustrationDocument>(
                      "copilotLayoutIllustrations",
                    )
                    .find(
                      { storeId: store.storeId, ownerId: store.userId },
                      { session },
                    )
                    .sort({ createdAt: -1, _id: -1 })
                    .limit(51)
                    .toArray()
                : null;
            const illustrationGenerations =
              query.layoutIllustrationGenerations === "true" &&
              query.copilotHistory === "true"
                ? await mongoDatabase
                    .collection<IllustrationGenerationDocument>(
                      "copilotLayoutIllustrationGenerations",
                    )
                    .find(
                      { storeId: store.storeId, ownerId: store.userId },
                      { session },
                    )
                    .sort({ createdAt: -1, _id: -1 })
                    .limit(51)
                    .toArray()
                : null;
            const decisions =
              query.copilotDecisions === "true" &&
              query.copilotHistory === "true"
                ? await mongoDatabase
                    .collection<DecisionDocument>("copilotDecisions")
                    .find(
                      { storeId: store.storeId, ownerId: store.userId },
                      { session },
                    )
                    .limit(501)
                    .toArray()
                : null;
            if (decisions && decisions.length > 500)
              throw Error("COPILOT_DECISION_LIMIT");
            const knowledge =
              query.copilotKnowledge === "true"
                ? await mongoDatabase
                    .collection<KnowledgeDocument>("copilotKnowledge")
                    .find(
                      { storeId: store.storeId, ownerId: store.userId },
                      { session },
                    )
                    .limit(501)
                    .toArray()
                : null;
            if (knowledge && knowledge.length > 500)
              throw Error("COPILOT_KNOWLEDGE_LIMIT");
            const copilotHistory =
              query.copilotHistory === "true"
                ? await chatBootstrap(
                    mongoDatabase,
                    store.storeId,
                    store.userId,
                    session,
                    supportsHistoryDeletion,
                    supportsAnalyticsDestinations,
                  )
                : {};
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
            const layouts =
              query.storeLayouts === "true"
                ? await mongoDatabase
                    .collection<StoreLayoutDocument>("storeLayouts")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const layoutRevisions =
              query.storeLayouts === "true"
                ? await mongoDatabase
                    .collection<StoreLayoutRevisionDocument>(
                      "storeLayoutRevisions",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .sort({ "plan.version": 1 })
                    .toArray()
                : [];
            const contextSettings =
              query.storeContext === "true"
                ? await mongoDatabase
                    .collection<StoreContextDocument>("storeContextSettings")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const needUnitRows =
              query.needUnits === "true"
                ? await mongoDatabase
                    .collection<NeedUnitDocument>("needUnits")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const membershipRows =
              query.needMemberships === "true"
                ? await mongoDatabase
                    .collection<NeedMembershipDocument>("needMemberships")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const substitutionRows =
              query.productSubstitutions === "true"
                ? await mongoDatabase
                    .collection<ProductSubstitutionDocument>(
                      "productSubstitutions",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const storeEventRows =
              query.storeProductEvents === "true"
                ? await mongoDatabase
                    .collection<StoreProductEventDocument>("storeProductEvents")
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const scoreHistory =
              query.substitutionScores === "true"
                ? await mongoDatabase
                    .collection<ScoreHistoryDocument>(
                      "substitutionScoreHistory",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .sort({ relationshipVersion: 1, _id: 1 })
                    .toArray()
                : [];
            const evidenceRows =
              query.substitutionEvidence === "true"
                ? await mongoDatabase
                    .collection<SubstitutionEvidenceDocument>(
                      "substitutionEvidence",
                    )
                    .find({ storeId: store.storeId }, { session })
                    .toArray()
                : [];
            const evidenceStates =
              query.substitutionEvidence === "true"
                ? await mongoDatabase
                    .collection<EvidenceStateDocument>(
                      "substitutionEvidenceStates",
                    )
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
              // New canonical channel is replayed through bounded pull pages, including historical imports.
              cursor: encodeSyncCursor(
                store.storeId,
                query.mercalysPublications === "true" ? Long.ZERO : sequence,
              ),
              historyPolicy: {
                rawObservationDays: query.rawObservationDays,
              },
              entities: {
                ...copilotHistory,
                ...(query.emailIntake === "true" &&
                query.copilotHistory === "true"
                  ? {
                      emailIntakeHistoryRequired: true as const,
                      emailIntakeOwnerId: store.userId,
                    }
                  : {}),
                ...(actions
                  ? {
                      copilotActionExecutions: actions.map(
                        serializeActionExecution,
                      ),
                      copilotActionExecutionOwnerId: store.userId,
                    }
                  : {}),
                ...(links
                  ? {
                      copilotExecutionLinks: links.map(serializeExecutionLink),
                      copilotExecutionLinkOwnerId: store.userId,
                    }
                  : {}),
                ...(illustrations
                  ? {
                      layoutIllustrations: illustrations
                        .slice(0, 50)
                        .map(serializeLayoutIllustration),
                      layoutIllustrationOwnerId: store.userId,
                      ...(illustrations.length > 50
                        ? { layoutIllustrationHistoryRequired: true as const }
                        : {}),
                    }
                  : {}),
                ...(illustrationGenerations
                  ? {
                      layoutIllustrationGenerations: illustrationGenerations
                        .slice(0, 50)
                        .map(serializeIllustrationGeneration),
                      layoutIllustrationGenerationOwnerId: store.userId,
                      ...(illustrationGenerations.length > 50
                        ? {
                            layoutIllustrationGenerationHistoryRequired:
                              true as const,
                          }
                        : {}),
                    }
                  : {}),
                ...(decisions
                  ? {
                      copilotDecisions: decisions.map(serializeDecision),
                      copilotDecisionOwnerId: store.userId,
                    }
                  : {}),
                ...(knowledge
                  ? {
                      copilotKnowledgeOwnerId: store.userId,
                      copilotKnowledge: knowledge.map(serializeKnowledge),
                    }
                  : {}),
                ...(query.mercalysPublications === "true"
                  ? { mercalysPublications: [] }
                  : {}),
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
                      commercialWeekPlans: weekPlans.map((r) =>
                        query.physicalAllocations === "true"
                          ? serializeCommercialPlan(r)
                          : legacyPhysicalPlan(serializeCommercialPlan(r)),
                      ),
                    }
                  : {}),
                ...(query.commercialPlans === "true"
                  ? {
                      commercialPlanRevisions: planRevisions.map((r) =>
                        query.physicalAllocations === "true"
                          ? serializeCommercialPlanRevision(r)
                          : legacyPhysicalEntity(
                              "commercial_week_plan_revision",
                              serializeCommercialPlanRevision(r),
                            ),
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
                ...visualEntities,
                ...(query.physicalAllocations === "true"
                  ? { physicalAllocations: true }
                  : {}),
                ...(query.storeLayouts === "true"
                  ? {
                      storeLayouts: layouts.map(serializeStoreLayout),
                      storeLayoutRevisions: layoutRevisions.map(
                        serializeStoreLayoutRevision,
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
                ...(query.needUnits === "true"
                  ? {
                      needUnitCatalogue: needUnitRows.map(serializeNeedUnit),
                    }
                  : {}),
                ...(query.needMemberships === "true"
                  ? {
                      productNeedMemberships: membershipRows.map(
                        serializeNeedMembership,
                      ),
                    }
                  : {}),
                ...(query.productSubstitutions === "true"
                  ? {
                      directedProductSubstitutions: substitutionRows.map(
                        serializeProductSubstitution,
                      ),
                    }
                  : {}),
                ...(query.storeProductEvents === "true"
                  ? {
                      productStoreEvents: storeEventRows.map(
                        serializeStoreProductEvent,
                      ),
                    }
                  : {}),
                ...(query.substitutionScores === "true"
                  ? {
                      substitutionScoreHistory: scoreHistory.map(
                        serializeScoreHistory,
                      ),
                    }
                  : {}),
                ...(query.substitutionEvidence === "true"
                  ? {
                      dailySubstitutionEvidence: evidenceRows.map(
                        serializeSubstitutionEvidence,
                      ),
                      dailySubstitutionEvidenceStates: evidenceStates.map(
                        serializeSubstitutionEvidenceState,
                      ),
                    }
                  : {}),
                ...(query.commercialExecution === "true"
                  ? {
                      commercialExecutionActuals:
                        query.commercialExecutionActuals === "true",
                      commercialExecutionTasks: executionTasks.map((row) =>
                        query.commercialExecutionActuals === "true"
                          ? serializeCommercialExecution(row)
                          : legacyCommercialExecution(
                              serializeCommercialExecution(row),
                            ),
                      ),
                    }
                  : {}),
                ...(query.commercialPreparation === "true"
                  ? {
                      commercialWeekPreparations: preparations.map((r) =>
                        query.physicalAllocations === "true"
                          ? serializeCommercialPreparation(r)
                          : legacyPhysicalPreparation(
                              serializeCommercialPreparation(r),
                            ),
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
