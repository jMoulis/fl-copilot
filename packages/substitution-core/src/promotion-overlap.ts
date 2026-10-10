import { z } from "zod";
import {
  commercialWeekPlanSchema,
  needMembershipSchema,
  productSubstitutionSchema,
  type CommercialWeekPlan,
  type NeedMembership,
  type ProductSubstitution,
} from "@fl-copilot/domain";
import {
  substitutionBehaviouralFit,
  type LookupParent,
  type LookupRecord,
} from "./lookup";
export const promotionOverlapPolicySchema = z
  .object({
    version: z.literal("promotion-overlap.v1"),
    minimumMembershipStrength: z.number().finite().min(0).max(1),
    minimumSubstitutionFit: z.number().finite().min(0).max(1),
  })
  .strict();
export const promotionOverlapPolicy = {
  version: "promotion-overlap.v1" as const,
  minimumMembershipStrength: 0.7,
  minimumSubstitutionFit: 0.7,
};
export type PromotionOverlapSupport =
  | {
      kind: "SHARED_NEED";
      needUnitId: string;
      membershipIds: [string, string];
      membershipVersions: [number, number];
      strengths: [number, number];
      confidences: [number, number];
    }
  | {
      kind: "DIRECTED_SUBSTITUTION";
      needUnitId: string;
      relationshipId: string;
      relationshipVersion: number;
      sourceProductId: string;
      substituteProductId: string;
      fit: number;
      basis: "DECLARED" | "LEARNED";
      confidence: number | null;
    };
export type PromotionOverlap = {
  id: string;
  planId: string;
  revisionId: string;
  planVersion: number;
  ruleVersion: "promotion-overlap.v1";
  first: CommercialWeekPlan["offers"][number];
  second: CommercialWeekPlan["offers"][number];
  start: string;
  end: string;
  support: PromotionOverlapSupport[];
  interpretation: "POTENTIAL_COMMERCIAL_OVERLAP";
  impact: z.infer<typeof impactSchema>;
};
const impactSchema = z.object({
  salesTransfer: z.null(),
  lostSales: z.null(),
  marginImpact: z.null(),
});
const safeSync = (s: string) => s === "SYNCED" || s === "PENDING";
const active = (r: LookupRecord<LookupParent> | undefined, storeId: string) =>
  !!r &&
  r.entity.storeId === storeId &&
  r.entity.status === "ACTIVE" &&
  !r.entity.deletedAt &&
  safeSync(r.syncState);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Planned temporal proximity and confirmed graph fit are risk indicators, never causal measurements. */
export function detectPromotionOverlaps(input: {
  storeId: string;
  plan: CommercialWeekPlan;
  fromDate?: string;
  products: LookupRecord<LookupParent>[];
  needs: LookupRecord<LookupParent>[];
  memberships: LookupRecord<NeedMembership>[];
  relations: LookupRecord<ProductSubstitution>[];
  policy?: z.infer<typeof promotionOverlapPolicySchema>;
}) {
  const plan = commercialWeekPlanSchema.parse(input.plan),
    policy = promotionOverlapPolicySchema.parse(
      input.policy ?? promotionOverlapPolicy,
    );
  if (plan.storeId !== input.storeId)
    throw Error("PROMOTION_OVERLAP_STORE_INVALID");
  const fromDate = input.fromDate
    ? z.string().date().parse(input.fromDate)
    : plan.weekStart;
  const products = new Map(
      input.products
        .filter((p) => p.entity.storeId === input.storeId)
        .map((p) => [p.entity.id, p]),
    ),
    needs = new Map(
      input.needs
        .filter((n) => n.entity.storeId === input.storeId)
        .map((n) => [n.entity.id, n]),
    );
  const memberships = input.memberships
    .filter((m) => m.entity.storeId === input.storeId && safeSync(m.syncState))
    .map((m) => needMembershipSchema.parse(m.entity))
    .filter(
      (m) =>
        m.humanConfirmed &&
        m.status === "VALIDATED" &&
        m.strength >= policy.minimumMembershipStrength &&
        active(needs.get(m.needUnitId), input.storeId),
    );
  const relations = input.relations
    .filter((r) => r.entity.storeId === input.storeId && safeSync(r.syncState))
    .map((r) => productSubstitutionSchema.parse(r.entity))
    .filter(
      (r) =>
        r.humanConfirmed &&
        ["VALIDATED", "LEARNING"].includes(r.status) &&
        active(needs.get(r.needUnitId), input.storeId),
    )
    .map((r) => ({ relation: r, ...substitutionBehaviouralFit(r) }))
    .filter((r) => r.fit >= policy.minimumSubstitutionFit);
  const offers = [...plan.offers]
    .filter((o) => active(products.get(o.productId), input.storeId))
    .sort((a, b) => compare(a.id, b.id));
  const warnings: PromotionOverlap[] = [];
  for (let i = 0; i < offers.length; i++)
    for (const b of offers.slice(i + 1)) {
      const a = offers[i]!;
      if (a.productId === b.productId) continue;
      const start = [a.saleStart, b.saleStart, plan.weekStart, fromDate]
          .sort()
          .at(-1)!,
        end = [a.saleEnd, b.saleEnd, plan.weekEnd].sort()[0]!;
      if (start > end) continue;
      const support: PromotionOverlapSupport[] = [];
      const ma = memberships.filter((m) => m.productId === a.productId),
        mb = memberships.filter((m) => m.productId === b.productId);
      for (const x of ma)
        for (const y of mb)
          if (x.needUnitId === y.needUnitId)
            support.push({
              kind: "SHARED_NEED",
              needUnitId: x.needUnitId,
              membershipIds: [x.id, y.id],
              membershipVersions: [x.version, y.version],
              strengths: [x.strength, y.strength],
              confidences: [x.confidence, y.confidence],
            });
      for (const r of relations)
        if (
          (r.relation.sourceProductId === a.productId &&
            r.relation.substituteProductId === b.productId) ||
          (r.relation.sourceProductId === b.productId &&
            r.relation.substituteProductId === a.productId)
        )
          support.push({
            kind: "DIRECTED_SUBSTITUTION",
            needUnitId: r.relation.needUnitId,
            relationshipId: r.relation.id,
            relationshipVersion: r.relation.version,
            sourceProductId: r.relation.sourceProductId,
            substituteProductId: r.relation.substituteProductId,
            fit: r.fit,
            basis: r.basis,
            confidence: r.relation.confidence,
          });
      if (!support.length) continue;
      support.sort(
        (a, b) =>
          compare(a.kind, b.kind) ||
          compare(a.needUnitId, b.needUnitId) ||
          compare(JSON.stringify(a), JSON.stringify(b)),
      );
      warnings.push({
        id: `${plan.revisionId}:${a.id}:${b.id}`,
        planId: plan.id,
        revisionId: plan.revisionId,
        planVersion: plan.version,
        ruleVersion: policy.version,
        first: a,
        second: b,
        start,
        end,
        support,
        interpretation: "POTENTIAL_COMMERCIAL_OVERLAP",
        impact: impactSchema.parse({
          salesTransfer: null,
          lostSales: null,
          marginImpact: null,
        }),
      });
    }
  return { ruleVersion: policy.version, warnings };
}
