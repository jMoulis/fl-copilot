import { NeedMembershipRepository } from "../needs/membership-repository";
import {
  currentCommercialWeek,
  commercialPlanNeedsReview,
  commercialPlanTensions,
  type CommercialTension,
} from "@fl-copilot/commercial-core";
import {
  lookupSubstitutes,
  detectPromotionOverlaps,
} from "@fl-copilot/substitution-core";
import { synchronizedCommercialVisualReadingSchema } from "@fl-copilot/sync-contracts";
import { ProductMasterRepository } from "../products/product-master-repository";
import { ProductSubstitutionRepository } from "../needs/substitution-repository";
import { NeedUnitRepository } from "../needs/repository";
import { StoreProductEventRepository } from "../needs/store-event-repository";
import {
  substituteReadOnly,
  substituteReadOnlyReader,
} from "../needs/lookup-repository";
import { readSubstitutionMarginContext } from "../needs/substitution-context";
import { CommercialPlanRepository } from "./week-plan-repository";
import { readWeekPlanContext } from "./week-plan-context";
import { readValidatedOffers } from "./validated-offer-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
export class WeeklySubstituteRepository {
  constructor(private db: AtomicMutationDatabase) {}
  async read(
    storeId: string,
    weekStart: string,
    expected?: { id: string; version: number; revisionId: string },
    at = new Date().toISOString(),
  ) {
    let snapshot: Awaited<ReturnType<typeof readSnapshot>> | undefined;
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      snapshot = await readSnapshot(tx, storeId, weekStart, expected, at);
    });
    if (!snapshot) throw Error("WEEKLY_SUBSTITUTES_SNAPSHOT_MISSING");
    return snapshot;
  }
}
async function readSnapshot(
  tx: OutboxDatabase,
  storeId: string,
  weekStart: string,
  expected: { id: string; version: number; revisionId: string } | undefined,
  at: string,
) {
  const reader = substituteReadOnlyReader(tx),
    record = await new CommercialPlanRepository(reader, async () =>
      substituteReadOnly(),
    ).get(storeId, weekStart);
  if (!record) return { status: "NO_PLAN" as const };
  const plan = record.entity;
  const today = currentCommercialWeek(new Date(at)).date;
  if (plan.weekEnd < today) return { status: "PAST_WEEK" as const };
  if (plan.storeId !== storeId || plan.weekStart !== weekStart)
    throw Error("WEEKLY_SUBSTITUTES_STORE_INVALID");
  if (
    expected &&
    (plan.id !== expected.id ||
      plan.version !== expected.version ||
      plan.revisionId !== expected.revisionId)
  )
    return { status: "PLAN_CHANGED" as const };
  if (!["SYNCED", "PENDING"].includes(record.syncState))
    return { status: "PLAN_REVIEW" as const };
  const [ctx, validated, p, n, r, e, ids, memberships] = await Promise.all([
    readWeekPlanContext(reader, plan.preparation),
    readValidatedOffers(reader, storeId),
    new ProductMasterRepository(reader).listProducts(storeId),
    new NeedUnitRepository(reader).list(storeId),
    new ProductSubstitutionRepository(reader, async () =>
      substituteReadOnly(),
    ).list(storeId),
    new StoreProductEventRepository(reader).list(storeId),
    new ProductMasterRepository(reader).listIdentifiersByStore(storeId),
    new NeedMembershipRepository(reader, async () => substituteReadOnly()).list(
      storeId,
    ),
  ]);
  if (commercialPlanNeedsReview(plan, ctx).length)
    return { status: "PLAN_REVIEW" as const };
  const projection = commercialPlanTensions({
    plan,
    validated: validated
      .filter((v) => ["SYNCED", "PENDING"].includes(v.syncState))
      .map((v) => v.entity),
    pages: ctx.pages.map((page) =>
      synchronizedCommercialVisualReadingSchema.parse(page),
    ),
    identifiers: ids.map((i) => ({ ...i.entity, syncState: i.syncState })),
  });
  if (projection.status !== "READY")
    return { status: "SOURCE_UNAVAILABLE" as const };
  const actionable = projection.tensions.filter(
    (t) =>
      t.status === "ANNOUNCED" &&
      t.productId &&
      (!t.planningWindow || t.planningWindow.end >= today),
  );
  const contexts = actionable.map((t) => ({
    tension: t,
    lookup: lookupSubstitutes({
      storeId,
      productId: t.productId!,
      at,
      products: p,
      needs: n,
      relations: r,
      events: e,
    }),
  }));
  const margins = await readSubstitutionMarginContext(
    reader,
    storeId,
    contexts.flatMap((c) => [
      c.tension.productId!,
      ...c.lookup.candidates.map((c) => c.productId),
    ]),
  );
  const contextFor = (productId: string, tension: CommercialTension) => {
    const plannedOffers = plan.offers.filter(
      (o) =>
        o.productId === productId &&
        (!tension.planningWindow ||
          (o.saleStart <= tension.planningWindow.end &&
            o.saleEnd >= tension.planningWindow.start)),
    );
    return {
      margin: margins[productId],
      waste: "NOT_EVALUATED" as const,
      plannedOffers: plannedOffers.map((o) => ({
        id: o.id,
        operationId: o.operationId,
        name: plan.operations.find((op) => op.id === o.operationId)!.name,
        start: o.saleStart,
        end: o.saleEnd,
        mechanism: o.customerMechanism,
      })),
      placements: plan.preparation.placements
        .filter((p) =>
          plannedOffers.some((o) => p.offerIds.includes(o.choiceId)),
        )
        .map((p) => ({ id: p.id, label: p.label })),
      otherTensions: projection.tensions
        .filter((t) => t.productId === productId && t.status === "ANNOUNCED")
        .map((t) => ({ id: t.id, label: t.label })),
    };
  };
  return {
    status: "READY" as const,
    ruleVersion: projection.ruleVersion,
    overlaps: detectPromotionOverlaps({
      storeId,
      plan,
      fromDate: today,
      products: p,
      needs: n,
      memberships,
      relations: r,
    }).warnings,
    planId: plan.id,
    revisionId: plan.revisionId,
    planVersion: plan.version,
    syncState: record.syncState,
    weekStart: plan.weekStart,
    weekEnd: plan.weekEnd,
    evaluatedAt: at,
    labels: Object.fromEntries(p.map((p) => [p.entity.id, p.entity.label])),
    needs: Object.fromEntries(n.map((n) => [n.entity.id, n.entity.name])),
    pastOfferCount: projection.tensions.filter(
      (t) =>
        t.status === "ANNOUNCED" &&
        t.planningWindow &&
        t.planningWindow.end < today,
    ).length,
    review: projection.tensions.filter((t) => t.status === "REVIEW"),
    items: contexts.map((c) => ({
      ...c,
      sourceContext: contextFor(c.tension.productId!, c.tension),
      candidates: c.lookup.candidates.map((candidate) => ({
        ...candidate,
        commercialContext: contextFor(candidate.productId, c.tension),
      })),
    })),
  };
}
