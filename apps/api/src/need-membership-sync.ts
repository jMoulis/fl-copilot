import { createHash } from "node:crypto";
import { needMembershipId, sameMembershipValues } from "@fl-copilot/domain";
import {
  needMembershipSchema,
  type NeedMembership,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";

export type NeedMembershipDocument = NeedMembership & { _id: string };
export function serializeNeedMembership(row: NeedMembershipDocument) {
  const { _id, ...data } = row;
  void _id;
  return needMembershipSchema.parse(data);
}
export async function applyNeedMembershipCommand(
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
  const parsed = needMembershipSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "need_membership"
  )
    return reject(
      "NEED_MEMBERSHIP_INVALID",
      "Vérifiez le produit, le besoin et les niveaux de cette association.",
    );
  const plan = parsed.data,
    id = plan.id;
  const collection =
      ctx.database.collection<NeedMembershipDocument>("needMemberships"),
    previous = await collection.findOne(
      { _id: id, storeId },
      { session: ctx.session },
    );
  const foreign = await collection.findOne(
    { _id: id },
    { session: ctx.session },
  );
  if (foreign && foreign.storeId !== storeId)
    return reject(
      "NEED_MEMBERSHIP_STORE_INVALID",
      "Cette unité ne peut pas être réaffectée à un autre magasin.",
    );
  if (
    previous &&
    command.expectedRemoteVersion === null &&
    plan.version === 1 &&
    previous.version === 1 &&
    sameMembershipValues(previous, plan)
  )
    return {
      resultStatus: "APPLIED",
      resultingVersion: previous.version,
      responseJson: { remoteEntity: serializeNeedMembership(previous) },
    };
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous
          ? { remoteEntity: serializeNeedMembership(previous) }
          : {}),
        error: {
          code: "NEED_MEMBERSHIP_VERSION_CONFLICT",
          messageFr:
            "Cette association a changé sur un autre appareil. Comparez les deux versions.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    plan.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !(
        plan.id === previous.id &&
        plan.storeId === previous.storeId &&
        plan.createdAt === previous.createdAt
      ))
  )
    return reject(
      "NEED_MEMBERSHIP_REVISION_INVALID",
      "Rouvrez cette association avant de la modifier.",
    );
  if (
    plan.id !==
    (await needMembershipId(
      storeId,
      plan.productId,
      plan.needUnitId,
      async (s) => createHash("sha256").update(s).digest("hex"),
    ))
  )
    return reject(
      "NEED_MEMBERSHIP_ID_INVALID",
      "L’identité de cette association est invalide.",
    );
  if (
    previous &&
    (previous.productId !== plan.productId ||
      previous.needUnitId !== plan.needUnitId ||
      previous.source !== plan.source)
  )
    return reject(
      "NEED_MEMBERSHIP_IDENTITY_CHANGED",
      "Les références et l’origine de cette association sont conservées.",
    );
  if (!previous && plan.source === "LEARNED")
    return reject(
      "NEED_MEMBERSHIP_ORIGIN_INVALID",
      "Un apprentissage ne peut pas être créé par cette commande.",
    );
  const product = await ctx.database
    .collection<{
      _id: string;
      storeId: string;
      status: string;
      deletedAt?: Date | null;
    }>("products")
    .findOne({ _id: plan.productId }, { session: ctx.session });
  const need = await ctx.database
    .collection<{ _id: string; storeId: string; status: string }>("needUnits")
    .findOne({ _id: plan.needUnitId }, { session: ctx.session });
  if (!product || !need) throw new NeedMembershipParentPendingError();
  if (product.storeId !== storeId || need.storeId !== storeId)
    return reject(
      "NEED_MEMBERSHIP_PARENT_INVALID",
      "Cette association doit rester dans le même magasin.",
    );
  if (
    plan.status !== "REJECTED" &&
    (product.deletedAt ||
      product.status === "INACTIVE" ||
      need.status === "INACTIVE" ||
      (plan.status === "VALIDATED" &&
        (product.status !== "ACTIVE" || need.status !== "ACTIVE")))
  )
    return reject(
      "NEED_MEMBERSHIP_PARENT_INACTIVE",
      "Activez et vérifiez le produit et le besoin avant de les associer.",
    );
  if (previous && !plan.humanConfirmed && previous.status !== "PROPOSED")
    return reject(
      "NEED_MEMBERSHIP_HUMAN_DECISION_REQUIRED",
      "Une décision déjà validée ou rejetée doit être revue explicitement.",
    );
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("needMembershipHistory").insertOne(
    {
      storeId,
      membershipId: id,
      version: plan.version,
      commandId: command.commandId,
      membership: plan,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "need_membership",
    entityId: id,
    entityVersion: plan.version,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: plan.version,
    responseJson: { remoteEntity: plan },
  };
}

export class NeedMembershipParentPendingError extends Error {
  constructor() {
    super("NEED_MEMBERSHIP_PARENT_PENDING");
  }
}
