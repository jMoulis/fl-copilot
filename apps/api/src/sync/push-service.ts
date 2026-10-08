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
  push(input: SyncPushRequest, requestId: string): Promise<SyncPushResponse>;
}

export function createMongoSyncPushService(
  database: DatabaseService,
  now: () => Date = () => new Date(),
): SyncPushService {
  const processedCommands = createMongoProcessedCommandService(database, now);
  const syncChanges = createMongoSyncChangeService(now);

  return {
    async push(input, requestId) {
      const results: SyncCommandResult[] = [];
      for (const command of input.commands) {
        try {
          const outcome = await processedCommands.execute(
            {
              commandId: command.commandId,
              storeId: input.storeId,
              deviceId: input.deviceId,
              commandType: command.type,
              entityType: command.entityType,
              entityId: command.entityId,
            },
            (context) =>
              applyCommand(
                context,
                input.storeId,
                command,
                requestId,
                now,
                syncChanges,
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
          results.push(
            toCommandResult(outcome.command, outcome.alreadyApplied),
          );
        } catch (error) {
          results.push(
            error instanceof ProcessedCommandIdentityError
              ? rejectedIdentityResult(command, requestId)
              : retryableResult(command, requestId),
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
) {
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
