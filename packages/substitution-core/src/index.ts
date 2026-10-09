import {
  membershipBatchToolRequestSchema,
  needMembershipId,
  needMembershipSchema,
  sameMembershipValues,
  type NeedMembership,
} from "@fl-copilot/domain";
export type MembershipParent = {
  id: string;
  storeId: string;
  status: string;
  deletedAt?: string | null;
};
export async function prepareNeedMembershipBatch(input: {
  request: unknown;
  products: MembershipParent[];
  needs: MembershipParent[];
  existing: NeedMembership[];
  actor: "USER" | "AI";
  decision: "PROPOSE" | "VALIDATE" | "REJECT";
  humanConfirmed: boolean;
  now: string;
  digest: (text: string) => Promise<string>;
  expectedVersions?: Record<string, number | null>;
}) {
  const req = membershipBatchToolRequestSchema.parse(input.request);
  if (
    input.actor === "AI" &&
    (input.decision !== "PROPOSE" || input.humanConfirmed)
  )
    throw Error("NEED_MEMBERSHIP_HUMAN_DECISION_REQUIRED");
  if (input.decision !== "PROPOSE" && !input.humanConfirmed)
    throw Error("NEED_MEMBERSHIP_HUMAN_DECISION_REQUIRED");
  const prepared: NeedMembership[] = [],
    skipped: Array<{
      productId: string;
      needUnitId: string;
      reason: "UNCHANGED" | "HUMAN_DECISION_PRESERVED";
    }> = [],
    seen = new Set<string>();
  for (const c of req.candidates) {
    const key = `${c.productId}:${c.needUnitId}`;
    if (seen.has(key)) throw Error("NEED_MEMBERSHIP_DUPLICATE_TARGET");
    seen.add(key);
    const p = input.products.find((p) => p.id === c.productId),
      n = input.needs.find((n) => n.id === c.needUnitId);
    if (!p || !n || p.storeId !== req.storeId || n.storeId !== req.storeId)
      throw Error("NEED_MEMBERSHIP_PARENT_INVALID");
    if (
      input.decision !== "REJECT" &&
      (p.deletedAt ||
        p.status === "INACTIVE" ||
        n.status === "INACTIVE" ||
        (input.decision === "VALIDATE" &&
          (p.status !== "ACTIVE" || n.status !== "ACTIVE")))
    )
      throw Error("NEED_MEMBERSHIP_PARENT_INACTIVE");
    const id = await needMembershipId(
        req.storeId,
        c.productId,
        c.needUnitId,
        input.digest,
      ),
      old = input.existing.find((m) => m.id === id);
    if (
      old &&
      (old.storeId !== req.storeId ||
        old.productId !== c.productId ||
        old.needUnitId !== c.needUnitId)
    )
      throw Error("NEED_MEMBERSHIP_IDENTITY_CHANGED");
    if (
      input.actor === "AI" &&
      old &&
      (old.status !== "PROPOSED" ||
        old.source !== "AI_PROPOSED" ||
        old.humanConfirmed)
    ) {
      skipped.push({ ...c, reason: "HUMAN_DECISION_PRESERVED" });
      continue;
    }
    const value = needMembershipSchema.parse({
      ...c,
      id,
      storeId: req.storeId,
      source: old?.source ?? (input.actor === "AI" ? "AI_PROPOSED" : "MANUAL"),
      status: {
        PROPOSE: "PROPOSED",
        VALIDATE: "VALIDATED",
        REJECT: "REJECTED",
      }[input.decision],
      humanConfirmed: input.humanConfirmed,
      version: Object.prototype.hasOwnProperty.call(
        input.expectedVersions ?? {},
        id,
      )
        ? (input.expectedVersions![id] ?? 0) + 1
        : (old?.version ?? 0) + 1,
      createdAt: old?.createdAt ?? input.now,
      updatedAt: input.now,
    });
    if (
      old &&
      !Object.prototype.hasOwnProperty.call(input.expectedVersions ?? {}, id) &&
      sameMembershipValues(old, value)
    ) {
      skipped.push({ ...c, reason: "UNCHANGED" });
      continue;
    }
    prepared.push(value);
  }
  return { prepared, skipped };
}

export { prepareProductSubstitutionBatch } from "./substitution-batch";
