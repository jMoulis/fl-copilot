import type {
  CommercialWeekPlan,
  CommercialWeekPreparation,
  CommercialPlanReviewBasis,
} from "@fl-copilot/domain";
import {
  buildCommercialWeekPlan,
  prepareCommercialPlanReview,
} from "@fl-copilot/commercial-core";
import { StoreContextRepository } from "../store/context-repository";
import {
  joinedMutationDatabase,
  type AtomicMutationDatabase,
} from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { readWeekPlanContext } from "./week-plan-context";
import { ValidatedOfferRepository } from "./validated-offer-repository";
import { CommercialPlanRepository } from "./week-plan-repository";

export async function readCommercialPlanReview(
  db: OutboxDatabase,
  preparation: CommercialWeekPreparation,
  digest: (s: string) => Promise<string>,
  observedAt: string,
) {
  const context = await readWeekPlanContext(db, preparation);
  const settings = await new StoreContextRepository(
    joinedMutationDatabase(db),
  ).get(preparation.storeId);
  const review = await prepareCommercialPlanReview(
    preparation,
    context,
    settings?.entity ?? null,
    digest,
    observedAt,
  );
  if (settings && ["CONFLICT", "ERROR"].includes(settings.syncState))
    review.issues.push({
      code: "STORE_CONTEXT_SYNC",
      messageFr:
        "Le contexte magasin est en conflit ou en erreur. Résolvez-le dans Synchronisation avant de confirmer le plan.",
    });
  return review;
}

/** One explicit decision, canonical offer and plan writers in the same SQLite transaction. */
export async function saveReviewedCommercialPlan(
  db: OutboxDatabase & AtomicMutationDatabase,
  candidate: CommercialWeekPlan,
  basis: CommercialPlanReviewBasis,
  ctx: {
    deviceId: string;
    commandId: string;
    generateId: () => string;
    appliedAt: string;
    canConfirm: () => boolean;
  },
  digest: (s: string) => Promise<string>,
) {
  let saved: CommercialWeekPlan | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!ctx.canConfirm()) throw Error("COMMERCIAL_PLAN_FORBIDDEN");
    const review = await readCommercialPlanReview(
      tx,
      candidate.preparation,
      digest,
      candidate.validatedAt,
    );
    if (
      review.issues.length ||
      JSON.stringify(review.basis) !== JSON.stringify(basis)
    )
      throw Error("COMMERCIAL_PLAN_DATA_CHANGED");
    const rebuilt = await buildCommercialWeekPlan(
      {
        preparation: candidate.preparation,
        version: candidate.version,
        createdAt: candidate.createdAt,
        validatedAt: candidate.validatedAt,
      },
      review.context,
      digest,
    );
    if (JSON.stringify(rebuilt) !== JSON.stringify(candidate))
      throw Error("COMMERCIAL_PLAN_DATA_CHANGED");
    const joined = joinedMutationDatabase(tx);
    if (basis.offerRefs.length)
      await new ValidatedOfferRepository(joined, digest).validate(
        candidate.storeId,
        basis.offerRefs,
        {
          deviceId: ctx.deviceId,
          commandIds: basis.offerRefs.map(() => ctx.generateId()),
          createdAt: ctx.appliedAt,
        },
      );
    const repo = new CommercialPlanRepository(joined, digest);
    const before = await repo.get(candidate.storeId, candidate.weekStart);
    const after = await buildCommercialWeekPlan(
      {
        preparation: candidate.preparation,
        version: candidate.version,
        createdAt: before?.entity.createdAt ?? ctx.appliedAt,
        validatedAt: ctx.appliedAt,
      },
      await readWeekPlanContext(tx, candidate.preparation),
      digest,
    );
    await repo.save(after, {
      deviceId: ctx.deviceId,
      commandId: ctx.commandId,
    });
    if (!ctx.canConfirm()) throw Error("COMMERCIAL_PLAN_FORBIDDEN");
    saved = after;
  });
  if (!saved) throw Error("COMMERCIAL_PLAN_DATA_CHANGED");
  return saved;
}
