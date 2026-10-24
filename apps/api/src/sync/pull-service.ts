import { advanceProductUnitRefresh } from "../analytics/product-unit-refresh";
import { requireCommercialSourceCompatibility } from "../commercial/source-compatibility";
import {
  readableEmailDecisions,
  type EmailDecisionDocument,
} from "../intake/email-decision-sync";
import { isVisualEntityType } from "@fl-copilot/domain";
import {
  visualCollections,
  serializeVisualEntity,
} from "../products/visual-library-sync";
import { legacyPhysicalEntity } from "@fl-copilot/domain";
import {
  serializeStoreLayout,
  serializeStoreLayoutRevision,
  type StoreLayoutDocument,
  type StoreLayoutRevisionDocument,
} from "../store-layout-sync";
import { legacyCommercialExecution } from "@fl-copilot/domain";
import { synchronizedMercalysPublicationSchema } from "@fl-copilot/sync-contracts";
import type { MercalysPublicationDocument } from "../imports/mercalys-publication-sync.js";
import {
  isChatType,
  serializeChatForClient,
  chatCollections,
} from "../copilot/conversation-store";
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
  loadCommercialReviewEntity,
} from "../commercial/review-sync.js";
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
  pull(
    storeId: string,
    query: SyncPullQuery,
    ownerId?: string,
    supportsHistoryDeletion?: boolean,
    supportsAnalyticsDestinations?: boolean | 2,
  ): Promise<SyncPullResponse>;
}

export function createMongoSyncPullService(
  database: DatabaseService,
  now: () => Date = () => new Date(),
): SyncPullService {
  return {
    async pull(
      storeId,
      query,
      ownerId,
      supportsHistoryDeletion = false,
      supportsAnalyticsDestinations: boolean | 2 = false,
    ) {
      const afterSequence = query.cursor
        ? decodeCursor(query.cursor, storeId)
        : Long.ZERO;
      if (query.commercialReview === "true")
        await registerCommercialReviewPages(database, storeId);
      await advanceProductUnitRefresh(database, storeId, now);
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
      const privateEntities = new Map<
        string,
        import("../copilot/conversation-store").ChatRecordDocument
      >();
      if (query.copilotHistory === "true" && ownerId) {
        await Promise.all(
          Object.entries(chatCollections).map(async ([type, collection]) => {
            const ids = selected
              .filter((change) => change.entityType === type)
              .map((change) => change.entityId);
            if (
              !ids.length ||
              (type === "email_intake_decision" &&
                query.emailIntake !== "true") ||
              (type === "copilot_action_execution" &&
                query.copilotActionExecutions !== "true") ||
              (type === "copilot_execution_link" &&
                query.copilotExecutionLinks !== "true") ||
              (type === "copilot_layout_illustration_generation" &&
                query.layoutIllustrationGenerations !== "true") ||
              (type === "copilot_layout_illustration" &&
                query.layoutIllustrations !== "true") ||
              (type === "copilot_decision" &&
                query.copilotDecisions !== "true") ||
              (type === "copilot_knowledge" &&
                query.copilotKnowledge !== "true")
            )
              return;
            const rows = await mongoDatabase
              .collection<
                import("../copilot/conversation-store").ChatRecordDocument
              >(collection)
              .find({ _id: { $in: ids }, storeId, ownerId })
              .toArray();
            const readable =
              type === "email_intake_decision"
                ? await readableEmailDecisions(
                    mongoDatabase,
                    storeId,
                    ownerId,
                    rows as EmailDecisionDocument[],
                  )
                : rows;
            for (const row of readable)
              privateEntities.set(`${type}:${row._id}`, row);
          }),
        );
      }
      // Freeze the whole legacy import channel once row revisions exist. Sending a later
      // replacement while withholding its revised predecessor would double-count old rows.
      const legacyMercalysFrozen =
        query.mercalysPublications === "true" &&
        query.mercalysRecordUpdates !== "true" &&
        selected.some((c) => c.entityType === "mercalys_publication") &&
        !!(await mongoDatabase
          .collection<{ _id: string; mercalysRecordUpdatesRequired?: boolean }>(
            "syncStoreCounters",
          )
          .findOne(
            { _id: storeId, mercalysRecordUpdatesRequired: true },
            { projection: { _id: 1 }, maxTimeMS: 2000 },
          ));
      const changes = await Promise.all(
        selected
          .filter(
            (change) =>
              (query.visualLibrary === "true" ||
                !isVisualEntityType(change.entityType)) &&
              (query.mercalysPublications === "true" ||
                change.entityType !== "mercalys_publication") &&
              (!legacyMercalysFrozen ||
                change.entityType !== "mercalys_publication") &&
              (change.entityType !== "copilot_action_execution" ||
                query.copilotActionExecutions === "true") &&
              (change.entityType !== "copilot_execution_link" ||
                query.copilotExecutionLinks === "true") &&
              (change.entityType !== "email_intake_decision" ||
                query.emailIntake === "true") &&
              (change.entityType !== "copilot_layout_illustration_generation" ||
                query.layoutIllustrationGenerations === "true") &&
              (change.entityType !== "copilot_layout_illustration" ||
                query.layoutIllustrations === "true") &&
              (change.entityType !== "copilot_decision" ||
                query.copilotDecisions === "true") &&
              (change.entityType !== "copilot_knowledge" ||
                query.copilotKnowledge === "true") &&
              (!isChatType(change.entityType) ||
                (query.copilotHistory === "true" && !!ownerId)) &&
              (query.commercialReview === "true" ||
                ![
                  "commercial_review_page",
                  "commercial_review_decision",
                ].includes(change.entityType)) &&
              (query.commercialVisual === "true" ||
                change.entityType !== "commercial_visual_reading") &&
              (query.commercialChoices === "true" ||
                change.entityType !== "commercial_offer_choice") &&
              (query.commercialPreparation === "true" ||
                change.entityType !== "commercial_week_preparation") &&
              (query.commercialExecution === "true" ||
                change.entityType !== "commercial_execution_task") &&
              (query.storeLayouts === "true" ||
                !["store_layout", "store_layout_revision"].includes(
                  change.entityType,
                )) &&
              (query.storeContext === "true" ||
                change.entityType !== "store_context_settings") &&
              (query.needUnits === "true" ||
                change.entityType !== "need_unit") &&
              (query.needMemberships === "true" ||
                change.entityType !== "need_membership") &&
              (query.productSubstitutions === "true" ||
                change.entityType !== "product_substitution") &&
              (query.storeProductEvents === "true" ||
                change.entityType !== "store_product_event") &&
              (query.substitutionScores === "true" ||
                change.entityType !== "substitution_score_history") &&
              (query.substitutionEvidence === "true" ||
                ![
                  "substitution_evidence",
                  "substitution_evidence_state",
                ].includes(change.entityType)) &&
              (query.commercialVersions === "true" ||
                change.entityType !== "commercial_version_decision") &&
              (query.commercialValidation === "true" ||
                change.entityType !== "commercial_validated_offer") &&
              (query.commercialPlans === "true" ||
                ![
                  "commercial_week_plan",
                  "commercial_week_plan_revision",
                ].includes(change.entityType)),
          )
          .map(async (change) => {
            if (isVisualEntityType(change.entityType)) {
              const row = await mongoDatabase
                .collection<{ _id: string }>(
                  visualCollections[change.entityType],
                )
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("VISUAL_SYNC_INVALID");
              const entity = serializeVisualEntity(change.entityType, row);
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                entityVersion: entity.version,
                operation: change.operation,
                entity,
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (isChatType(change.entityType)) {
              const row = privateEntities.get(
                `${change.entityType}:${change.entityId}`,
              );
              if (!row) return null;
              if (change.operation !== "UPSERT")
                throw Error("COPILOT_HISTORY_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                entityVersion: row.version,
                operation: change.operation,
                entity: serializeChatForClient(
                  change.entityType,
                  row,
                  supportsHistoryDeletion,
                  supportsAnalyticsDestinations,
                ),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_week_plan") {
              const row = await mongoDatabase
                .collection<WeekPlanDocument>("commercialWeekPlans")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_PLAN_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity:
                  query.physicalAllocations === "true"
                    ? serializeCommercialPlan(row)
                    : legacyPhysicalEntity(
                        "commercial_week_plan",
                        serializeCommercialPlan(row),
                      ),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_week_plan_revision") {
              const row = await mongoDatabase
                .collection<PlanRevisionDocument>("commercialPlanRevisions")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_PLAN_REVISION_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: 1,
                entity:
                  query.physicalAllocations === "true"
                    ? serializeCommercialPlanRevision(row)
                    : legacyPhysicalEntity(
                        "commercial_week_plan_revision",
                        serializeCommercialPlanRevision(row),
                      ),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_validated_offer") {
              const row = await mongoDatabase
                .collection<ValidatedOfferDocument>("commercialValidatedOffers")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_VALIDATION_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeValidatedOffer(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_version_decision") {
              const row = await mongoDatabase
                .collection<VersionDecisionDocument>(
                  "commercialVersionDecisions",
                )
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_VERSION_DECISION_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeCommercialVersionDecision(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (
              change.entityType === "store_layout" ||
              change.entityType === "store_layout_revision"
            ) {
              const revision = change.entityType === "store_layout_revision";
              const row = revision
                ? await mongoDatabase
                    .collection<StoreLayoutRevisionDocument>(
                      "storeLayoutRevisions",
                    )
                    .findOne({ _id: change.entityId, storeId })
                : await mongoDatabase
                    .collection<StoreLayoutDocument>("storeLayouts")
                    .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("STORE_LAYOUT_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: revision
                  ? serializeStoreLayoutRevision(
                      row as StoreLayoutRevisionDocument,
                    )
                  : serializeStoreLayout(row as StoreLayoutDocument),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "store_context_settings") {
              const row = await mongoDatabase
                .collection<StoreContextDocument>("storeContextSettings")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("STORE_CONTEXT_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeStoreContext(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "need_unit") {
              const row = await mongoDatabase
                .collection<NeedUnitDocument>("needUnits")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("NEED_UNIT_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeNeedUnit(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "need_membership") {
              const row = await mongoDatabase
                .collection<NeedMembershipDocument>("needMemberships")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("NEED_MEMBERSHIP_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeNeedMembership(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "product_substitution") {
              const row = await mongoDatabase
                .collection<ProductSubstitutionDocument>("productSubstitutions")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("PRODUCT_SUBSTITUTION_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeProductSubstitution(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "substitution_score_history") {
              const row = await mongoDatabase
                .collection<ScoreHistoryDocument>("substitutionScoreHistory")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("SUBSTITUTION_SCORE_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: 1,
                entity: serializeScoreHistory(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "store_product_event") {
              const row = await mongoDatabase
                .collection<StoreProductEventDocument>("storeProductEvents")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("STORE_EVENT_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeStoreProductEvent(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (
              change.entityType === "substitution_evidence" ||
              change.entityType === "substitution_evidence_state"
            ) {
              const evidence = change.entityType === "substitution_evidence";
              const row = evidence
                ? await mongoDatabase
                    .collection<SubstitutionEvidenceDocument>(
                      "substitutionEvidence",
                    )
                    .findOne({ _id: change.entityId, storeId })
                : await mongoDatabase
                    .collection<EvidenceStateDocument>(
                      "substitutionEvidenceStates",
                    )
                    .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("SUBSTITUTION_EVIDENCE_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: evidence
                  ? serializeSubstitutionEvidence(
                      row as SubstitutionEvidenceDocument,
                    )
                  : serializeSubstitutionEvidenceState(
                      row as EvidenceStateDocument,
                    ),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_execution_task") {
              const row = await mongoDatabase
                .collection<ExecutionTaskDocument>("commercialExecutionTasks")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_EXECUTION_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity:
                  query.commercialExecutionActuals === "true"
                    ? serializeCommercialExecution(row)
                    : legacyCommercialExecution(
                        serializeCommercialExecution(row),
                      ),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_week_preparation") {
              const row = await mongoDatabase
                .collection<PreparationDocument>("commercialWeekPreparations")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_PREPARATION_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity:
                  query.physicalAllocations === "true"
                    ? serializeCommercialPreparation(row)
                    : legacyPhysicalEntity(
                        "commercial_week_preparation",
                        serializeCommercialPreparation(row),
                      ),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_offer_choice") {
              const row = await mongoDatabase
                .collection<OfferChoiceDocument>("commercialOfferChoices")
                .findOne({ _id: change.entityId, storeId });
              if (!row || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_CHOICE_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: row.version,
                entity: serializeCommercialChoice(row),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "commercial_visual_reading") {
              const reading = await mongoDatabase
                .collection<VisualReadingDocument>("commercialVisualReadings")
                .findOne({
                  _id: change.entityId,
                  storeId,
                  status: { $in: ["READY", "FAILED"] },
                });
              if (!reading || change.operation !== "UPSERT")
                throw Error("COMMERCIAL_VISUAL_SYNC_INVALID");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: 1,
                entity: serializeVisualReading(reading),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (
              ["commercial_review_page", "commercial_review_decision"].includes(
                change.entityType,
              )
            ) {
              if (change.operation !== "UPSERT")
                throw Error("Commercial review deletion unsupported");
              const entity = await loadCommercialReviewEntity(
                mongoDatabase,
                storeId,
                change.entityId,
                change.entityType,
              );
              if (!entity) throw Error("Commercial review entity missing");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: 1,
                entity,
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "mercalys_publication") {
              const entity = await mongoDatabase
                .collection<MercalysPublicationDocument>("mercalysPublications")
                .findOne({ _id: change.entityId, storeId });
              if (!entity) throw Error("MERCALYS_PUBLICATION_MISSING");
              // Legacy clients only insert source records and cannot safely consume row revisions.
              if (
                query.mercalysRecordUpdates !== "true" &&
                entity.publication.records.some((r) => r.version > 1)
              )
                return null;
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: entity.version,
                entity: synchronizedMercalysPublicationSchema.parse(entity),
                changedAt: change.changedAt.toISOString(),
              };
            }
            if (change.entityType === "waste_receipt_publication") {
              const entity = await mongoDatabase
                .collection<
                  import("../uploads/waste-receipt-publication.js").WastePublicationDocument
                >("wasteReceiptPublications")
                .findOne({ _id: change.entityId, storeId });
              if (!entity) throw new Error("Waste publication missing.");
              return {
                sequence: change.sequence.toString(),
                entityType: change.entityType,
                entityId: change.entityId,
                operation: change.operation,
                entityVersion: entity.version,
                entity: {
                  id: entity.id,
                  storeId: entity.storeId,
                  remoteVersion: entity.remoteVersion,
                  publication: entity.publication,
                },
                changedAt: change.changedAt.toISOString(),
              };
            }
            return toEnvelope(change, entities, productEntities);
          }),
      );
      const ready = changes.filter(
        (c): c is NonNullable<typeof c> => c !== null,
      );
      const bounded: typeof ready = [];
      let bytes = 1024,
        truncated = false;
      for (const c of ready) {
        const size = Buffer.byteLength(JSON.stringify(c), "utf8");
        if (bounded.length && bytes + size > 2 * 1024 * 1024) {
          truncated = true;
          break;
        }
        bounded.push(c);
        bytes += size + 1;
      }
      const nextSequence = truncated
        ? Long.fromString(bounded.at(-1)!.sequence)
        : (selected.at(-1)?.sequence ?? afterSequence);

      await requireCommercialSourceCompatibility(
        mongoDatabase,
        storeId,
        query.commercialOriginalSources === "true",
      );
      return {
        changes: bounded,
        nextCursor: encodeSyncCursor(storeId, nextSequence),
        hasMore: hasMore || truncated,
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
