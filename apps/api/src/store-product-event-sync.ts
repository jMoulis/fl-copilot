import {
  storeProductEventSchema,
  prepareStoreProductEvent,
  closeStoreProductEvent,
  sameStoreEventCapture,
  closeStoreEventPayloadSchema,
  type StoreProductEvent,
} from "@fl-copilot/domain";
import type { SyncCommand } from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";
export type StoreProductEventDocument = StoreProductEvent & { _id: string };
export function serializeStoreProductEvent(row: StoreProductEventDocument) {
  const { _id, ...event } = row;
  void _id;
  return storeProductEventSchema.parse(event);
}
export class StoreEventParentPendingError extends Error {
  constructor() {
    super("STORE_EVENT_PARENT_PENDING");
  }
}
export async function applyStoreProductEventCommand(
  ctx: MongoCommandMutationContext,
  storeId: string,
  command: SyncCommand,
  requestId: string,
  changes: ReturnType<typeof createMongoSyncChangeService>,
): Promise<CommandMutationResult> {
  const reject = (code: string, messageFr: string): CommandMutationResult => ({
    resultStatus: "REJECTED",
    resultingVersion: null,
    responseJson: { error: { code, messageFr, retryable: false, requestId } },
  });
  if (command.entityType !== "store_product_event")
    return reject("STORE_EVENT_INVALID", "Vérifiez ce signalement.");
  const collection =
      ctx.database.collection<StoreProductEventDocument>("storeProductEvents"),
    foreign = await collection.findOne(
      { _id: command.entityId },
      { session: ctx.session },
    );
  if (foreign && foreign.storeId !== storeId)
    return reject(
      "STORE_EVENT_STORE_INVALID",
      "Ce signalement appartient à un autre magasin.",
    );
  const previous = foreign;
  const conflict = (): CommandMutationResult => ({
    resultStatus: "CONFLICT",
    resultingVersion: previous?.version ?? null,
    responseJson: {
      ...(previous
        ? { remoteEntity: serializeStoreProductEvent(previous) }
        : {}),
      error: {
        code: "STORE_EVENT_VERSION_CONFLICT",
        messageFr:
          "La clôture ou le signalement a changé sur un autre appareil. Comparez les versions.",
        retryable: false,
        requestId,
      },
    },
  });
  let event: StoreProductEvent;
  if (command.type === "CREATE_STORE_EVENT") {
    try {
      event = prepareStoreProductEvent(storeId, command.payload);
    } catch {
      return reject(
        "STORE_EVENT_INVALID",
        "Vérifiez le produit, le type, les dates et la note du signalement.",
      );
    }
    if (event.id !== command.entityId || command.expectedRemoteVersion !== null)
      return reject(
        "STORE_EVENT_IDENTITY_CHANGED",
        "Un nouveau signalement conserve son identifiant initial.",
      );
    if (previous) {
      if (sameStoreEventCapture(previous, event)) {
        const first =
          previous.version === 1
            ? previous
            : (
                await ctx.database
                  .collection<{
                    storeId: string;
                    eventId: string;
                    version: number;
                    event: StoreProductEvent;
                  }>("storeProductEventHistory")
                  .findOne(
                    { storeId, eventId: event.id, version: 1 },
                    { session: ctx.session },
                  )
              )?.event;
        if (first && first.endedAt === event.endedAt)
          return {
            resultStatus: "APPLIED",
            resultingVersion: previous.version,
            responseJson: {
              remoteEntity: serializeStoreProductEvent(previous),
            },
          };
      }
      return conflict();
    }
    const product = await ctx.database
      .collection<{ _id: string; storeId: string; deletedAt?: Date | null }>(
        "products",
      )
      .findOne({ _id: event.productId }, { session: ctx.session });
    if (!product) throw new StoreEventParentPendingError();
    if (product.storeId !== storeId || product.deletedAt)
      return reject(
        "STORE_EVENT_PRODUCT_INVALID",
        "Ce produit doit être présent dans le magasin du signalement.",
      );
  } else if (command.type === "CLOSE_STORE_EVENT") {
    const parsed = closeStoreEventPayloadSchema.safeParse(command.payload);
    if (!parsed.success)
      return reject(
        "STORE_EVENT_END_INVALID",
        "Vérifiez la date et l’heure de fin.",
      );
    if (!previous) throw new StoreEventParentPendingError();
    if (previous.source !== "USER")
      return reject(
        "STORE_EVENT_SOURCE_INVALID",
        "Une instruction commerciale n’est pas un incident magasin à clôturer.",
      );
    if (
      previous.status === "CLOSED" &&
      previous.endedAt === parsed.data.endedAt
    )
      return {
        resultStatus: "APPLIED",
        resultingVersion: previous.version,
        responseJson: { remoteEntity: serializeStoreProductEvent(previous) },
      };
    if (command.expectedRemoteVersion !== previous.version) return conflict();
    try {
      event = closeStoreProductEvent(
        serializeStoreProductEvent(previous),
        parsed.data.endedAt,
        command.createdAt,
      );
    } catch {
      return reject(
        "STORE_EVENT_END_INVALID",
        "La fin doit se situer après le début, sans être dans le futur de votre capture.",
      );
    }
  } else
    return reject(
      "STORE_EVENT_COMMAND_INVALID",
      "Cette action de signalement est inconnue.",
    );
  await collection.replaceOne({ _id: event.id, storeId }, event, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("storeProductEventHistory").insertOne(
    {
      storeId,
      eventId: event.id,
      version: event.version,
      commandId: command.commandId,
      event,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "store_product_event",
    entityId: event.id,
    entityVersion: event.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: event.version,
    responseJson: { remoteEntity: event },
  };
}
