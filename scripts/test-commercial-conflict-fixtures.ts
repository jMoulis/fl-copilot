import { buildCommercialWeekPlan } from "../packages/commercial-core/src/index";
import { randomUUID } from "node:crypto";
import { commercialPlanFixture } from "./test-commercial-plan-fixtures";
import {
  nativeReceiptPublicationFixture,
  receiptReviewDigest,
} from "./test-receipt-publication-sqlite";
import { storeConflictPreview } from "./test-store-conflict-fixtures";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import { applyCommercialVisualReading } from "../apps/mobile/src/commercial/visual-repository";
import {
  CommercialChoiceRepository,
  applyCommercialChoice,
} from "../apps/mobile/src/commercial/offer-choice-repository";
import {
  CommercialPreparationRepository,
  applyCommercialPreparation,
} from "../apps/mobile/src/commercial/week-preparation-repository";
import {
  CommercialPlanRepository,
  applyCommercialPlan,
} from "../apps/mobile/src/commercial/week-plan-repository";
import { applyValidatedOffer } from "../apps/mobile/src/commercial/validated-offer-repository";
import { ConflictRepository } from "../apps/mobile/src/sync/conflict-repository";
import { OutboxRepository } from "../apps/mobile/src/sync/outbox-repository";
import { applyCopilotRecord } from "../apps/mobile/src/copilot/conversation-repository";
import { buildStoreConflictMessages } from "../apps/api/src/copilot/store-conflict-messages";
import { CopilotStoreConflictController } from "../apps/mobile/src/copilot/store-conflict-controller";
export const commercialConflictTables = {
  COMMERCIAL_CHOICE: "commercial_offer_choices",
  COMMERCIAL_PREPARATION: "commercial_week_preparations",
  COMMERCIAL_PLAN: "commercial_week_plans",
} as const;
export const commercialConflictEntities = {
  COMMERCIAL_CHOICE: "commercial_offer_choice",
  COMMERCIAL_PREPARATION: "commercial_week_preparation",
  COMMERCIAL_PLAN: "commercial_week_plan",
} as const;
export async function commercialConflictBase(path = ":memory:") {
  const s = await nativeReceiptPublicationFixture(path),
    { storeId, deviceId } = s.scope;
  const fixture = await commercialPlanFixture();
  // Fixture helpers carry stable source-derived IDs, so align the private fixture to their store.
  // Rebuild the commercial fixture in the authenticated store using the canonical digest helpers.
  const { makeCommercialChoiceFixture } =
    await import("./commercial-choice-fixture-data");
  const {
    commercialWeekPreparationId,
    commercialValidatedOfferId,
    commercialOfferValidationSource,
  } = await import("../packages/commercial-core/src/index");
  const f = await makeCommercialChoiceFixture(
      { storeId },
      receiptReviewDigest,
      randomUUID,
    ),
    preparation = {
      ...fixture.preparation,
      id: await commercialWeekPreparationId(
        storeId,
        fixture.preparation.weekStart,
        receiptReviewDigest,
      ),
      storeId,
      offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
      placements: fixture.preparation.placements.map((p) => ({
        ...p,
        offerIds: [f.choice.id],
      })),
    },
    validated = {
      ...fixture.validated,
      id: await commercialValidatedOfferId(
        storeId,
        f.choice.id,
        1,
        receiptReviewDigest,
      ),
      storeId,
      choice: f.choice,
      ...commercialOfferValidationSource(f.choice, [f.reading]),
    },
    context = {
      ...fixture.context,
      preparation,
      choices: [f.choice],
      validated: [validated],
      products: [
        {
          id: f.product.id,
          label: f.product.label,
          version: f.product.version,
        },
      ],
      pages: [f.reading],
    },
    plan = await buildCommercialWeekPlan(
      {
        preparation,
        version: 1,
        createdAt: f.choice.createdAt,
        validatedAt: f.choice.createdAt,
      },
      context,
      receiptReviewDigest,
    ),
    ctx = { commandId: randomUUID(), deviceId };
  await new ProductMasterRepository(s.a).upsertProduct(f.product, ctx);
  await s.a.runAsync(
    "UPDATE products SET sync_state='SYNCED',dirty=0 WHERE id=?",
    f.product.id,
  );
  await applyCommercialVisualReading(s.a, storeId, f.reading);
  await applyCommercialChoice(s.a, storeId, f.choice);
  await applyCommercialPreparation(s.a, storeId, preparation);
  await applyValidatedOffer(s.a, storeId, validated);
  await applyCommercialPlan(s.a, storeId, plan);
  await s.a.runAsync("UPDATE sync_outbox SET status='ACKNOWLEDGED'");
  return { ...s, fixture: { ...f, preparation, validated, plan, context } };
}
export async function nativeCommercialConflictFixture(
  kind: keyof typeof commercialConflictTables,
  path = ":memory:",
  withdrawal?: "LOCAL" | "REMOTE",
) {
  const { fixture: f, ...s } = await commercialConflictBase(path),
    { storeId, ownerId, deviceId } = s.scope,
    { preparation, plan, context } = f,
    ctx = { commandId: randomUUID(), deviceId };
  const local =
    kind === "COMMERCIAL_CHOICE"
      ? {
          ...f.choice,
          version: 2,
          note: "Choix local",
          status:
            withdrawal === "LOCAL"
              ? ("WITHDRAWN" as const)
              : ("RETAINED" as const),
        }
      : kind === "COMMERCIAL_PREPARATION"
        ? { ...preparation, version: 2, note: "Brouillon local" }
        : await buildCommercialWeekPlan(
            {
              preparation,
              version: 2,
              createdAt: plan.createdAt,
              validatedAt: "2026-10-11T12:00:00.000Z",
            },
            context,
            receiptReviewDigest,
          );
  const remote =
    kind === "COMMERCIAL_CHOICE"
      ? {
          ...f.choice,
          version: 2,
          note: "Choix distant",
          status:
            withdrawal === "REMOTE"
              ? ("WITHDRAWN" as const)
              : ("RETAINED" as const),
        }
      : kind === "COMMERCIAL_PREPARATION"
        ? { ...preparation, version: 2, note: "Brouillon distant" }
        : await buildCommercialWeekPlan(
            {
              preparation,
              version: 2,
              createdAt: plan.createdAt,
              validatedAt: "2026-10-11T13:00:00.000Z",
            },
            context,
            receiptReviewDigest,
          );
  const entityType = commercialConflictEntities[kind],
    table = commercialConflictTables[kind];
  if (kind === "COMMERCIAL_CHOICE")
    await new CommercialChoiceRepository(s.a, receiptReviewDigest).save(
      local as typeof f.choice,
      { ...ctx, commandId: randomUUID() },
    );
  else if (kind === "COMMERCIAL_PREPARATION")
    await new CommercialPreparationRepository(s.a, receiptReviewDigest).save(
      local as typeof preparation,
      { ...ctx, commandId: randomUUID() },
    );
  else
    await new CommercialPlanRepository(s.a, receiptReviewDigest).save(
      local as typeof plan,
      { ...ctx, commandId: randomUUID() },
    );
  const command = (await new OutboxRepository(s.a).listPending(storeId)).find(
    (c) => c.entityType === entityType,
  )!;
  const conflict = await new ConflictRepository(s.a).recordPushConflict(
    command,
    {
      commandId: command.commandId,
      status: "CONFLICT",
      entityType,
      entityId: remote.id,
      remoteVersion: remote.version,
      remoteEntity: remote,
    },
  );
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  await s.a.runAsync(
    `UPDATE ${table} SET sync_state='CONFLICT' WHERE id=?`,
    remote.id,
  );
  const preview = storeConflictPreview(kind, remote),
    message = buildStoreConflictMessages(s.f.assistant, [preview])[0]!;
  await s.a.withExclusiveTransactionAsync((tx) =>
    applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
  );
  const scope = {
      storeId,
      ownerId,
      deviceId,
      canCaptureStoreEvents: false,
      canManageStoreSettings: false,
      canManageCommercialChoices: true,
      canPrepareCommercialWeek: true,
      canValidateCommercialPlan: true,
    },
    controller = new CopilotStoreConflictController(
      s.a,
      scope,
      receiptReviewDigest,
      randomUUID,
    );
  return {
    ...s,
    review: {
      kind,
      remote,
      local,
      fixture: f,
      preview,
      message,
      scope,
      controller,
      conflict,
      entityType,
      table,
      command,
      state: await controller.open(message),
    },
  };
}
