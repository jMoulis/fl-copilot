import { isVisualEntityType } from "@fl-copilot/domain";
import {
  applyVisualCommand,
  VisualParentPendingError,
} from "../products/visual-library-sync";
import { legacyPhysicalEntity } from "@fl-copilot/domain";
import { applyStoreLayoutCommand } from "../store-layout-sync";
import {
  commercialExecutionTaskSchema,
  legacyCommercialExecution,
} from "@fl-copilot/domain";
import { KnowledgeParentPendingError } from "../copilot/knowledge-store";
import type { PrivateSourceReader } from "../imports/import-verification-service.js";
import { applyMercalysPublicationCommand } from "../imports/mercalys-publication-sync.js";
import { mercalysPublicationSchema } from "@fl-copilot/sync-contracts";
import {
  applyChatCommand,
  canAccessChatCommand,
  isChatType,
  ChatParentPendingError,
} from "../copilot/conversation-store";
import {
  applyNeedMembershipCommand,
  NeedMembershipParentPendingError,
} from "../need-membership-sync";
import {
  applyProductSubstitutionCommand,
  ProductSubstitutionParentPendingError,
} from "../product-substitution-sync";
import {
  applyStoreProductEventCommand,
  StoreEventParentPendingError,
} from "../store-product-event-sync";
import { applyNeedUnitCommand } from "../need-unit-sync";
import { applyStoreContextCommand } from "../store-context-sync.js";
import { applyCommercialExecutionCommand } from "../commercial/execution-sync.js";
import { applyCommercialPlanCommand } from "../commercial/week-plan-sync.js";
import { applyValidatedOfferCommand } from "../commercial/validated-offer-sync.js";
import { applyCommercialVersionDecisionCommand } from "../commercial/version-decision-sync.js";
import { applyCommercialPreparationCommand } from "../commercial/week-preparation-sync.js";
import { applyCommercialChoiceCommand } from "../commercial/offer-choice-sync.js";
import { applyCommercialReviewCommand } from "../commercial/review-sync.js";
import type {
  ApiErrorDto,
  SyncCommand,
  SyncCommandResult,
  SyncPushRequest,
  SyncPushResponse,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types.js";
import {
  createMongoProcessedCommandService,
  ProcessedCommandIdentityError,
  type MongoCommandMutationContext,
  type ProcessedCommandDocument,
} from "./processed-command-service.js";
import { createMongoSyncChangeService } from "./sync-change-service.js";
import {
  serializeSyncTestEntity,
  syncTestEntityPayloadSchema,
  type SyncTestEntityDocument,
} from "./sync-test-entity.js";
import {
  applyProductMasterCommand,
  isProductMasterCommand,
} from "../products/product-master.js";

import { applyWastePublicationCommand } from "../uploads/waste-receipt-publication.js";

import { wastePublicationSchema } from "@fl-copilot/sync-contracts";
import { createMongoRemoteAnalyticsConfirmationService } from "../analytics/remote-confirmation.js";

interface StoredCommandResponse {
  remoteEntity?: SyncCommandResult["remoteEntity"];
  error?: ApiErrorDto;
}

export interface SyncPushService {
  push(
    input: SyncPushRequest,
    requestId: string,
    ownerId?: string,
  ): Promise<SyncPushResponse>;
}

export function createMongoSyncPushService(
  database: DatabaseService,
  now: () => Date = () => new Date(),
  mercalysReader?: PrivateSourceReader,
): SyncPushService {
  const processedCommands = createMongoProcessedCommandService(database, now);
  const syncChanges = createMongoSyncChangeService(now);

  return {
    async push(input, requestId, ownerId) {
      const results: SyncCommandResult[] = [];
      for (const command of input.commands) {
        try {
          if (
            isChatType(command.entityType) ||
            command.type.startsWith("COPILOT_")
          ) {
            if (
              !(await canAccessChatCommand(
                await database.getDb(),
                input.storeId,
                ownerId,
                command,
              ))
            ) {
              results.push({
                commandId: command.commandId,
                entityType: command.entityType,
                entityId: command.entityId,
                status: "REJECTED",
                error: {
                  code: "COPILOT_HISTORY_ACCESS_INVALID",
                  messageFr: "Cette conversation n’est pas accessible.",
                  retryable: false,
                  requestId,
                },
              });
              continue;
            }
          }
          const outcome = await processedCommands.execute(
            {
              commandId: command.commandId,
              storeId: input.storeId,
              deviceId: input.deviceId,
              commandType: command.type,
              entityType: command.entityType,
              entityId: command.entityId,
              ...(isChatType(command.entityType) ||
              command.entityType === "store_layout" ||
              isVisualEntityType(command.entityType)
                ? { ownerId }
                : {}),
            },
            (context) =>
              applyCommand(
                context,
                input.storeId,
                command,
                requestId,
                now,
                syncChanges,
                ownerId,
                mercalysReader,
              ),
          );
          if (
            command.type === "WASTE_RECEIPT_PUBLISH" &&
            outcome.command.resultStatus === "APPLIED"
          ) {
            const publication = wastePublicationSchema.parse(command.payload);
            await createMongoRemoteAnalyticsConfirmationService(
              database,
            ).confirm(
              input.storeId,
              publication.observations.map((o) => ({
                productId: o.productId,
                businessDate: o.businessDate,
              })),
            );
          }
          if (
            command.type === "MERCALYS_PUBLISH" &&
            outcome.command.resultStatus === "APPLIED"
          ) {
            const p = mercalysPublicationSchema.parse(command.payload);
            await createMongoRemoteAnalyticsConfirmationService(
              database,
            ).confirm(
              input.storeId,
              [...p.sales, ...p.waste].map((o) => ({
                productId: o.productId,
                businessDate: o.businessDate,
              })),
            );
          }
          results.push(
            toCommandResult(outcome.command, outcome.alreadyApplied),
          );
        } catch (error) {
          results.push(
            error instanceof ProcessedCommandIdentityError
              ? rejectedIdentityResult(command, requestId)
              : error instanceof VisualParentPendingError ||
                  error instanceof KnowledgeParentPendingError ||
                  error instanceof ChatParentPendingError ||
                  error instanceof NeedMembershipParentPendingError ||
                  error instanceof ProductSubstitutionParentPendingError ||
                  error instanceof StoreEventParentPendingError
                ? {
                    ...retryableResult(command, requestId),
                    error: {
                      code: error.message,
                      messageFr:
                        error instanceof KnowledgeParentPendingError
                          ? "Synchronisez d’abord le message à l’origine de cette pratique."
                          : "Synchronisez d’abord les produits et le besoin client.",
                      retryable: true,
                      requestId,
                    },
                  }
                : retryableResult(command, requestId),
          );
        }
      }
      if (!input.physicalAllocations)
        for (const result of results)
          if (
            result.remoteEntity &&
            [
              "commercial_week_preparation",
              "commercial_week_plan",
              "commercial_week_plan_revision",
            ].includes(result.entityType)
          )
            result.remoteEntity = legacyPhysicalEntity(
              result.entityType,
              result.remoteEntity,
            );
      if (!input.commercialExecutionActuals)
        for (const result of results) {
          if (
            result.entityType === "commercial_execution_task" &&
            result.remoteEntity
          ) {
            result.remoteEntity = legacyCommercialExecution(
              commercialExecutionTaskSchema.parse(result.remoteEntity),
            );
          }
        }
      return { results, serverTime: now().toISOString() };
    },
  };
}

async function applyCommand(
  context: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  now: () => Date,
  syncChanges: ReturnType<typeof createMongoSyncChangeService>,
  ownerId?: string,
  mercalysReader?: PrivateSourceReader,
) {
  if (isVisualEntityType(command.entityType))
    return applyVisualCommand(
      context,
      storeId,
      command.entityType,
      command,
      requestId,
      syncChanges,
      ownerId,
    );
  if (isChatType(command.entityType))
    return applyChatCommand(
      context,
      storeId,
      ownerId!,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "MERCALYS_PUBLISH")
    return applyMercalysPublicationCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
      mercalysReader,
    );
  if (command.type === "COMMERCIAL_WEEK_PLAN_UPSERT")
    return applyCommercialPlanCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "COMMERCIAL_OFFER_VALIDATE")
    return applyValidatedOfferCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "COMMERCIAL_VERSION_DECISION_UPSERT")
    return applyCommercialVersionDecisionCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "STORE_LAYOUT_UPSERT")
    return applyStoreLayoutCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
      ownerId,
    );
  if (command.type === "STORE_CONTEXT_SETTINGS_UPSERT")
    return applyStoreContextCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "NEED_UNIT_UPSERT")
    return applyNeedUnitCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "NEED_MEMBERSHIP_UPSERT")
    return applyNeedMembershipCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "PRODUCT_SUBSTITUTION_UPSERT")
    return applyProductSubstitutionCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (
    command.type === "CREATE_STORE_EVENT" ||
    command.type === "CLOSE_STORE_EVENT"
  )
    return applyStoreProductEventCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "COMMERCIAL_EXECUTION_TASK_UPSERT")
    return applyCommercialExecutionCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
      now,
    );
  if (command.type === "COMMERCIAL_WEEK_PREPARATION_UPSERT")
    return applyCommercialPreparationCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "COMMERCIAL_OFFER_CHOICE_UPSERT")
    return applyCommercialChoiceCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "COMMERCIAL_TRANSCRIPTION_REVIEW")
    return applyCommercialReviewCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (command.type === "WASTE_RECEIPT_PUBLISH")
    return applyWastePublicationCommand(
      context,
      storeId,
      command,
      requestId,
      syncChanges,
    );
  if (isProductMasterCommand(command)) {
    return applyProductMasterCommand(
      context,
      storeId,
      command,
      requestId,
      now,
      syncChanges,
    );
  }
  if (
    command.type !== "SYNC_TEST_ENTITY_UPSERT" ||
    command.entityType !== "sync_test_entity"
  ) {
    return rejectedMutation(
      "SYNC_COMMAND_UNSUPPORTED",
      "Cette commande de synchronisation n’est pas prise en charge.",
      requestId,
    );
  }

  const parsed = syncTestEntityPayloadSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.id !== command.entityId ||
    parsed.data.storeId !== storeId
  ) {
    return rejectedMutation(
      "SYNC_COMMAND_INVALID",
      "Cette commande de synchronisation est invalide.",
      requestId,
    );
  }

  const collection =
    context.database.collection<SyncTestEntityDocument>("syncTestEntities");
  const existing = await collection.findOne(
    { _id: command.entityId },
    { session: context.session },
  );
  if (existing && existing.storeId !== storeId) {
    return rejectedMutation(
      "SYNC_ENTITY_STORE_MISMATCH",
      "Cette entité appartient à un autre magasin.",
      requestId,
    );
  }

  const expectedVersion = command.expectedRemoteVersion ?? null;
  const actualVersion = existing?.version ?? null;
  if (expectedVersion !== actualVersion) {
    return {
      resultStatus: "CONFLICT" as const,
      resultingVersion: actualVersion,
      responseJson: {
        ...(existing
          ? { remoteEntity: serializeSyncTestEntity(existing) }
          : {}),
        error: publicError(
          "SYNC_VERSION_CONFLICT",
          "Cette donnée a été modifiée sur un autre appareil.",
          requestId,
        ),
      } satisfies StoredCommandResponse,
    };
  }

  const timestamp = now();
  const entity: SyncTestEntityDocument = {
    _id: command.entityId,
    storeId,
    label: parsed.data.label,
    version: (actualVersion ?? 0) + 1,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await collection.replaceOne({ _id: entity._id }, entity, {
    upsert: true,
    session: context.session,
  });
  await syncChanges.append(context, {
    storeId,
    entityType: command.entityType,
    entityId: command.entityId,
    operation: "UPSERT",
    entityVersion: entity.version,
  });
  return {
    resultStatus: "APPLIED" as const,
    resultingVersion: entity.version,
    responseJson: {
      remoteEntity: serializeSyncTestEntity(entity),
    } satisfies StoredCommandResponse,
  };
}

function rejectedMutation(code: string, messageFr: string, requestId: string) {
  return {
    resultStatus: "REJECTED" as const,
    resultingVersion: null,
    responseJson: {
      error: publicError(code, messageFr, requestId),
    } satisfies StoredCommandResponse,
  };
}

function toCommandResult(
  command: ProcessedCommandDocument,
  alreadyProcessed: boolean,
): SyncCommandResult {
  const response = (command.responseJson ?? {}) as StoredCommandResponse;
  const status =
    alreadyProcessed && command.resultStatus === "APPLIED"
      ? ("ALREADY_APPLIED" as const)
      : command.resultStatus;
  return {
    commandId: command._id,
    status,
    entityType: command.entityType,
    entityId: command.entityId,
    remoteVersion: command.resultingVersion,
    ...(response.remoteEntity === undefined
      ? {}
      : { remoteEntity: response.remoteEntity }),
    ...(response.error === undefined ? {} : { error: response.error }),
  };
}

function retryableResult(
  command: SyncCommand,
  requestId: string,
): SyncCommandResult {
  return {
    commandId: command.commandId,
    status: "RETRYABLE_ERROR",
    entityType: command.entityType,
    entityId: command.entityId,
    error: publicError(
      "SYNC_TEMPORARILY_UNAVAILABLE",
      "Cette commande n’a pas pu être synchronisée. Réessayez.",
      requestId,
      true,
    ),
  };
}

function rejectedIdentityResult(
  command: SyncCommand,
  requestId: string,
): SyncCommandResult {
  return {
    commandId: command.commandId,
    status: "REJECTED",
    entityType: command.entityType,
    entityId: command.entityId,
    error: publicError(
      "SYNC_COMMAND_ID_REUSED",
      "L’identifiant de cette commande a déjà été utilisé.",
      requestId,
    ),
  };
}

function publicError(
  code: string,
  messageFr: string,
  requestId: string,
  retryable = false,
): ApiErrorDto {
  return { code, messageFr, retryable, requestId };
}
