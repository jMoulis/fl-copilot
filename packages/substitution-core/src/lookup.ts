import { z } from "zod";
import {
  productSubstitutionSchema,
  storeProductEventSchema,
  substitutionScorePolicySchema,
  type ProductSubstitution,
  type StoreProductEvent,
  type SubstitutionScorePolicy,
} from "@fl-copilot/domain";
import { conservativeSubstitutionScorePolicy } from "./scoring";
export const SUBSTITUTE_LOOKUP_RULE_VERSION = "substitute-lookup.v1";
export type LookupRecord<T> = { entity: T; syncState: string };
export type LookupParent = {
  id: string;
  storeId: string;
  status: string;
  deletedAt?: string | null;
};
export type LookupExclusion = {
  relationId: string;
  productId: string;
  needUnitId: string;
  reason:
    | "UNCONFIRMED"
    | "REJECTED"
    | "RELATION_SYNC_UNRESOLVED"
    | "PRODUCT_UNAVAILABLE"
    | "NEED_UNAVAILABLE"
    | "OUT_OF_STOCK"
    | "EVENT_UNRESOLVED";
};
export type LookupRelation = {
  relation: ProductSubstitution;
  syncState: string;
  fit: number;
  basis: "LEARNED" | "DECLARED";
};
export type SubstituteCandidate = LookupRelation & {
  productId: string;
  relationships: LookupRelation[];
  availability: "UNKNOWN";
  events: Array<{
    id: string;
    type: StoreProductEvent["type"];
    syncState: string;
  }>;
};
const safeSync = (s: string) => s === "SYNCED" || s === "PENDING";
const activeParent = (
  r: LookupRecord<LookupParent> | undefined,
  storeId: string,
) =>
  !!r &&
  r.entity.storeId === storeId &&
  r.entity.status === "ACTIVE" &&
  !r.entity.deletedAt &&
  safeSync(r.syncState);
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareRelation = (a: LookupRelation, b: LookupRelation) =>
  b.fit - a.fit ||
  (b.relation.confidence ?? -1) - (a.relation.confidence ?? -1) ||
  compareId(a.relation.id, b.relation.id);
function declaredFit(r: ProductSubstitution, p: SubstitutionScorePolicy) {
  const components: Array<[number | null, number]> = [
    [r.needCompatibility, p.needWeight],
    [r.usageCompatibility, p.usageWeight],
    [r.priceCompatibility, p.priceWeight],
    [r.packagingCompatibility, p.packagingWeight],
  ];
  let total = 0,
    weight = 0;
  for (const [value, w] of components)
    if (value !== null) {
      total += value * w;
      weight += w;
    }
  return total / weight;
}
/** Read-only directed lookup. No margin, price forecast, stock amount or AI input determines behavioural order. */
export function lookupSubstitutes(input: {
  storeId: string;
  productId: string;
  needUnitId?: string;
  at: string;
  products: LookupRecord<LookupParent>[];
  needs: LookupRecord<LookupParent>[];
  relations: LookupRecord<ProductSubstitution>[];
  events: LookupRecord<StoreProductEvent>[];
  policy?: SubstitutionScorePolicy;
}) {
  z.string().uuid().parse(input.storeId);
  z.string().uuid().parse(input.productId);
  if (input.needUnitId) z.string().uuid().parse(input.needUnitId);
  const at = z.string().datetime({ offset: true }).parse(input.at),
    instant = Date.parse(at),
    policy = substitutionScorePolicySchema.parse(
      input.policy ?? conservativeSubstitutionScorePolicy,
    ),
    products = new Map(
      input.products
        .filter((p) => p.entity.storeId === input.storeId)
        .map((p) => [p.entity.id, p]),
    ),
    needs = new Map(
      input.needs
        .filter((n) => n.entity.storeId === input.storeId)
        .map((n) => [n.entity.id, n]),
    );
  const excluded: LookupExclusion[] = [],
    groups = new Map<string, SubstituteCandidate>();
  if (!activeParent(products.get(input.productId), input.storeId))
    return {
      status: "SOURCE_UNAVAILABLE" as const,
      ruleVersion: SUBSTITUTE_LOOKUP_RULE_VERSION,
      evaluatedAt: at,
      candidates: [] as SubstituteCandidate[],
      excluded,
    };
  const activeEvents = input.events
    .filter((r) => r.entity.storeId === input.storeId)
    .map((r) => ({ ...r, entity: storeProductEventSchema.parse(r.entity) }))
    .filter(
      (r) =>
        r.entity.source === "USER" &&
        Date.parse(r.entity.startedAt) <= instant &&
        (!r.entity.endedAt || Date.parse(r.entity.endedAt) > instant),
    );
  for (const record of input.relations) {
    if (
      record.entity.storeId !== input.storeId ||
      record.entity.sourceProductId !== input.productId ||
      (input.needUnitId && record.entity.needUnitId !== input.needUnitId)
    )
      continue;
    const r = productSubstitutionSchema.parse(record.entity),
      events = activeEvents.filter(
        (e) => e.entity.productId === r.substituteProductId,
      );
    let reason: LookupExclusion["reason"] | undefined;
    if (r.status === "REJECTED") reason = "REJECTED";
    else if (!r.humanConfirmed || !["VALIDATED", "LEARNING"].includes(r.status))
      reason = "UNCONFIRMED";
    else if (!safeSync(record.syncState)) reason = "RELATION_SYNC_UNRESOLVED";
    else if (!activeParent(products.get(r.substituteProductId), input.storeId))
      reason = "PRODUCT_UNAVAILABLE";
    else if (!activeParent(needs.get(r.needUnitId), input.storeId))
      reason = "NEED_UNAVAILABLE";
    else if (
      events.some(
        (e) => e.entity.status === "TO_REVIEW" || !safeSync(e.syncState),
      )
    )
      reason = "EVENT_UNRESOLVED";
    else if (events.some((e) => e.entity.type === "OUT_OF_STOCK"))
      reason = "OUT_OF_STOCK";
    if (reason) {
      excluded.push({
        relationId: r.id,
        productId: r.substituteProductId,
        needUnitId: r.needUnitId,
        reason,
      });
      continue;
    }
    const row: LookupRelation = {
      relation: r,
      syncState: record.syncState,
      fit:
        Math.round((r.relationshipScore ?? declaredFit(r, policy)) * 1e8) / 1e8,
      basis: r.relationshipScore === null ? "DECLARED" : "LEARNED",
    };
    const old = groups.get(r.substituteProductId);
    if (old) old.relationships.push(row);
    else
      groups.set(r.substituteProductId, {
        ...row,
        productId: r.substituteProductId,
        relationships: [row],
        availability: "UNKNOWN",
        events: events
          .map((e) => ({
            id: e.entity.id,
            type: e.entity.type,
            syncState: e.syncState,
          }))
          .sort((a, b) => compareId(a.id, b.id)),
      });
  }
  const candidates = [...groups.values()]
    .map((c) => {
      const relationships = c.relationships.sort(compareRelation);
      return { ...c, ...relationships[0]!, relationships };
    })
    .sort(
      (a, b) => compareRelation(a, b) || compareId(a.productId, b.productId),
    );
  return {
    status: "READY" as const,
    ruleVersion: SUBSTITUTE_LOOKUP_RULE_VERSION,
    evaluatedAt: at,
    candidates,
    excluded: excluded.sort((a, b) => compareId(a.relationId, b.relationId)),
  };
}
