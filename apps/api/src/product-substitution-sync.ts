import { createHash } from "node:crypto";
import {
  productSubstitutionId,
  sameSubstitutionValues,
  sameSubstitutionLearning,
} from "@fl-copilot/domain";
import {
  productSubstitutionSchema,
  type ProductSubstitution,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "./sync/processed-command-service";
import type { createMongoSyncChangeService } from "./sync/sync-change-service";

export type ProductSubstitutionDocument = ProductSubstitution & { _id: string };
export function serializeProductSubstitution(row: ProductSubstitutionDocument) {
  const { _id, ...data } = row;
  void _id;
  return productSubstitutionSchema.parse(data);
}
export async function applyProductSubstitutionCommand(
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
  const parsed = productSubstitutionSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "product_substitution"
  )
    return reject(
      "PRODUCT_SUBSTITUTION_INVALID",
      "Vérifiez les produits, le besoin et les niveaux de cette relation.",
    );
  const plan = parsed.data,
    id = plan.id;
  const collection = ctx.database.collection<ProductSubstitutionDocument>(
      "productSubstitutions",
    ),
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
      "PRODUCT_SUBSTITUTION_STORE_INVALID",
      "Cette relation ne peut pas être réaffectée à un autre magasin.",
    );
  if (
    previous &&
    command.expectedRemoteVersion === null &&
    plan.version === 1 &&
    previous.version === 1 &&
    sameSubstitutionValues(previous, plan)
  )
    return {
      resultStatus: "APPLIED",
      resultingVersion: previous.version,
      responseJson: { remoteEntity: serializeProductSubstitution(previous) },
    };
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous
          ? { remoteEntity: serializeProductSubstitution(previous) }
          : {}),
        error: {
          code: "PRODUCT_SUBSTITUTION_VERSION_CONFLICT",
          messageFr:
            "Cette relation ou ses indices synchronisés ont changé. Comparez les deux versions.",
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
      "PRODUCT_SUBSTITUTION_REVISION_INVALID",
      "Rouvrez cette relation avant de la modifier.",
    );
  if (
    plan.id !==
    (await productSubstitutionId(
      storeId,
      plan.sourceProductId,
      plan.substituteProductId,
      plan.needUnitId,
      async (s) => createHash("sha256").update(s).digest("hex"),
    ))
  )
    return reject(
      "PRODUCT_SUBSTITUTION_ID_INVALID",
      "L’identité de cette relation est invalide.",
    );
  if (
    previous &&
    (previous.sourceProductId !== plan.sourceProductId ||
      previous.substituteProductId !== plan.substituteProductId ||
      previous.needUnitId !== plan.needUnitId ||
      previous.source !== plan.source)
  )
    return reject(
      "PRODUCT_SUBSTITUTION_IDENTITY_CHANGED",
      "Les références et l’origine de cette relation sont conservées.",
    );
  if (
    (previous &&
      (!sameSubstitutionLearning(previous, plan) ||
        (plan.status === "LEARNING" && previous.status !== "LEARNING"))) ||
    (!previous && (plan.evidenceCount !== 0 || plan.status === "LEARNING"))
  )
    return reject(
      "PRODUCT_SUBSTITUTION_LEARNING_READ_ONLY",
      "Les scores appris sont calculés à partir des observations synchronisées.",
    );
  if (!previous && plan.source === "LEARNED")
    return reject(
      "PRODUCT_SUBSTITUTION_ORIGIN_INVALID",
      "Un apprentissage ne peut pas être créé par cette commande.",
    );
  const product = await ctx.database
    .collection<{
      _id: string;
      storeId: string;
      status: string;
      deletedAt?: Date | null;
    }>("products")
    .findOne({ _id: plan.sourceProductId }, { session: ctx.session });
  const substitute = await ctx.database
    .collection<{
      _id: string;
      storeId: string;
      status: string;
      deletedAt?: Date | null;
    }>("products")
    .findOne({ _id: plan.substituteProductId }, { session: ctx.session });
  const need = await ctx.database
    .collection<{ _id: string; storeId: string; status: string }>("needUnits")
    .findOne({ _id: plan.needUnitId }, { session: ctx.session });
  if (!product || !substitute || !need)
    throw new ProductSubstitutionParentPendingError();
  if (
    product.storeId !== storeId ||
    substitute.storeId !== storeId ||
    need.storeId !== storeId
  )
    return reject(
      "PRODUCT_SUBSTITUTION_PARENT_INVALID",
      "Cette relation doit rester dans le même magasin.",
    );
  if (
    plan.status !== "REJECTED" &&
    (product.deletedAt ||
      substitute.deletedAt ||
      substitute.status === "INACTIVE" ||
      product.status === "INACTIVE" ||
      need.status === "INACTIVE" ||
      (plan.status === "VALIDATED" &&
        (product.status !== "ACTIVE" ||
          substitute.status !== "ACTIVE" ||
          need.status !== "ACTIVE")))
  )
    return reject(
      "PRODUCT_SUBSTITUTION_PARENT_INACTIVE",
      "Activez et vérifiez les produits et le besoin avant de valider la relation.",
    );
  if (previous && !plan.humanConfirmed && previous.status !== "PROPOSED")
    return reject(
      "PRODUCT_SUBSTITUTION_HUMAN_DECISION_REQUIRED",
      "Une décision déjà validée ou rejetée doit être revue explicitement.",
    );
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  await ctx.database.collection("productSubstitutionHistory").insertOne(
    {
      storeId,
      substitutionId: id,
      version: plan.version,
      commandId: command.commandId,
      substitution: plan,
    },
    { session: ctx.session },
  );
  await changes.append(ctx, {
    storeId,
    entityType: "product_substitution",
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

export class ProductSubstitutionParentPendingError extends Error {
  constructor() {
    super("PRODUCT_SUBSTITUTION_PARENT_PENDING");
  }
}
