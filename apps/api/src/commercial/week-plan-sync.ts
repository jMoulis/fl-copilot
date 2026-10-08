import { createHash } from "node:crypto";
import {
  commercialWeekPlanSchema,
  type CommercialWeekPlan,
  type SyncCommand,
} from "@fl-copilot/sync-contracts";
import {
  commercialWeekPlanId,
  commercialPlanSameIdentity,
  buildCommercialWeekPlan,
  commercialValidatedOfferId,
} from "@fl-copilot/commercial-core";
import {
  loadWeekPlanContext,
  CommercialPlanInputChanged,
} from "./week-plan-context";
import type {
  MongoCommandMutationContext,
  CommandMutationResult,
} from "../sync/processed-command-service";
import type { createMongoSyncChangeService } from "../sync/sync-change-service";
import {
  commercialPlanRevisionSchema,
  type CommercialPlanRevision,
} from "@fl-copilot/sync-contracts";
export type WeekPlanDocument = CommercialWeekPlan & { _id: string };
export function serializeCommercialPlan(row: WeekPlanDocument) {
  const { _id, ...data } = row;
  void _id;
  return commercialWeekPlanSchema.parse(data);
}
export async function applyCommercialPlanCommand(
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
  const parsed = commercialWeekPlanSchema.safeParse(command.payload);
  if (
    !parsed.success ||
    parsed.data.storeId !== storeId ||
    parsed.data.id !== command.entityId ||
    command.entityType !== "commercial_week_plan"
  )
    return reject(
      "COMMERCIAL_PLAN_INVALID",
      "Vérifiez le brouillon, ses offres validées et les confirmations du plan.",
    );
  const plan = parsed.data,
    id = await commercialWeekPlanId(storeId, plan.weekStart, async (text) =>
      createHash("sha256").update(text).digest("hex"),
    );
  if (id !== plan.id)
    return reject(
      "COMMERCIAL_PLAN_ID_INVALID",
      "Le plan ne correspond pas à cette semaine du magasin.",
    );
  const collection = ctx.database.collection<WeekPlanDocument>(
      "commercialWeekPlans",
    ),
    previous = await collection.findOne(
      { _id: id, storeId },
      { session: ctx.session },
    );
  if ((command.expectedRemoteVersion ?? null) !== (previous?.version ?? null))
    return {
      resultStatus: "CONFLICT",
      resultingVersion: previous?.version ?? null,
      responseJson: {
        ...(previous
          ? { remoteEntity: serializeCommercialPlan(previous) }
          : {}),
        error: {
          code: "COMMERCIAL_PLAN_VERSION_CONFLICT",
          messageFr:
            "Le plan a changé sur un autre appareil. Comparez les deux plans avant de choisir.",
          retryable: false,
          requestId,
        },
      },
    };
  if (
    plan.version !== (previous?.version ?? 0) + 1 ||
    (previous &&
      !commercialPlanSameIdentity(plan, serializeCommercialPlan(previous)))
  )
    return reject(
      "COMMERCIAL_PLAN_REVISION_INVALID",
      "Rouvrez le plan avant de modifier sa révision.",
    );
  for (const ref of plan.validationRefs)
    if (
      ref.validationId !==
      (await commercialValidatedOfferId(
        storeId,
        ref.choiceId,
        ref.choiceVersion,
        async (text) => createHash("sha256").update(text).digest("hex"),
      ))
    )
      return reject(
        "COMMERCIAL_PLAN_VALIDATION_INVALID",
        "Une référence de validation ne correspond pas à son offre.",
      );
  let context;
  try {
    context = await loadWeekPlanContext(ctx, plan);
  } catch (reason) {
    if (reason instanceof CommercialPlanInputChanged)
      return reject(
        reason.message,
        "Le brouillon, une offre, un produit ou une référence a changé. Rouvrez la semaine avant de confirmer.",
      );
    throw reason;
  }
  let expected: CommercialWeekPlan;
  try {
    expected = await buildCommercialWeekPlan(
      {
        preparation: plan.preparation,
        version: plan.version,
        createdAt: plan.createdAt,
        validatedAt: plan.validatedAt,
      },
      context,
      async (text) => createHash("sha256").update(text).digest("hex"),
    );
  } catch (reason) {
    return reject(
      reason instanceof Error ? reason.message : "COMMERCIAL_PLAN_INVALID",
      "Le brouillon, ses offres, ses produits ou ses sources doivent être revus avant de finaliser le plan.",
    );
  }
  if (JSON.stringify(expected) !== JSON.stringify(plan))
    return reject(
      "COMMERCIAL_PLAN_DATA_CHANGED",
      "Des références ou des regroupements ont changé. Rouvrez la semaine avant de confirmer le plan.",
    );
  await collection.replaceOne({ _id: id, storeId }, plan, {
    upsert: true,
    session: ctx.session,
  });
  for (const name of ["commercialOperations", "offers"])
    await ctx.database
      .collection(name)
      .deleteMany({ storeId, planId: plan.id }, { session: ctx.session });
  await ctx.database
    .collection<{ _id: string }>("commercialOperations")
    .insertMany(
      plan.operations.map((o) => ({ ...o, _id: o.id })),
      { session: ctx.session },
    );
  await ctx.database.collection<{ _id: string }>("offers").insertMany(
    plan.offers.map((o) => ({ ...o, _id: o.id })),
    { session: ctx.session },
  );
  const revision = commercialPlanRevisionSchema.parse({
    id: plan.revisionId,
    storeId,
    plan,
    version: 1,
  });
  await ctx.database
    .collection<PlanRevisionDocument>("commercialPlanRevisions")
    .insertOne({ ...revision, _id: revision.id }, { session: ctx.session });
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_week_plan",
    entityId: id,
    entityVersion: plan.version,
    operation: "UPSERT",
  });
  await changes.append(ctx, {
    storeId,
    entityType: "commercial_week_plan_revision",
    entityId: revision.id,
    entityVersion: 1,
    operation: "UPSERT",
  });
  return {
    resultStatus: "APPLIED",
    resultingVersion: plan.version,
    responseJson: { remoteEntity: plan },
  };
}

export type PlanRevisionDocument = CommercialPlanRevision & { _id: string };
export function serializeCommercialPlanRevision(row: PlanRevisionDocument) {
  const { _id, ...data } = row;
  void _id;
  return commercialPlanRevisionSchema.parse(data);
}
