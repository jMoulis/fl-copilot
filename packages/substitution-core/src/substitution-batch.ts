import {
  substitutionBatchToolRequestSchema,
  productSubstitutionId,
  productSubstitutionSchema,
  sameSubstitutionValues,
  type ProductSubstitution,
} from "@fl-copilot/domain";
import type { MembershipParent } from "./index";
export async function prepareProductSubstitutionBatch(input: {
  request: unknown;
  products: MembershipParent[];
  needs: MembershipParent[];
  existing: ProductSubstitution[];
  actor: "USER" | "AI";
  decision: "PROPOSE" | "VALIDATE" | "REJECT";
  humanConfirmed: boolean;
  now: string;
  digest: (text: string) => Promise<string>;
  expectedVersions?: Record<string, number | null>;
}) {
  const req = substitutionBatchToolRequestSchema.parse(input.request);
  if (
    input.actor === "AI" &&
    (input.decision !== "PROPOSE" || input.humanConfirmed)
  )
    throw Error("PRODUCT_SUBSTITUTION_HUMAN_DECISION_REQUIRED");
  if (input.decision !== "PROPOSE" && !input.humanConfirmed)
    throw Error("PRODUCT_SUBSTITUTION_HUMAN_DECISION_REQUIRED");
  const prepared: ProductSubstitution[] = [],
    skipped: Array<{
      sourceProductId: string;
      substituteProductId: string;
      needUnitId: string;
      reason: "UNCHANGED" | "HUMAN_DECISION_PRESERVED";
    }> = [],
    seen = new Set<string>();
  for (const c of req.candidates) {
    const key = `${c.sourceProductId}:${c.substituteProductId}:${c.needUnitId}`;
    if (seen.has(key)) throw Error("PRODUCT_SUBSTITUTION_DUPLICATE_TARGET");
    seen.add(key);
    const p = input.products.find((p) => p.id === c.sourceProductId),
      substitute = input.products.find((p) => p.id === c.substituteProductId),
      n = input.needs.find((n) => n.id === c.needUnitId);
    if (
      !p ||
      !substitute ||
      !n ||
      substitute.storeId !== req.storeId ||
      p.storeId !== req.storeId ||
      n.storeId !== req.storeId
    )
      throw Error("PRODUCT_SUBSTITUTION_PARENT_INVALID");
    if (
      input.decision !== "REJECT" &&
      (p.deletedAt ||
        substitute.deletedAt ||
        substitute.status === "INACTIVE" ||
        p.status === "INACTIVE" ||
        n.status === "INACTIVE" ||
        (input.decision === "VALIDATE" &&
          (p.status !== "ACTIVE" ||
            substitute.status !== "ACTIVE" ||
            n.status !== "ACTIVE")))
    )
      throw Error("PRODUCT_SUBSTITUTION_PARENT_INACTIVE");
    const id = await productSubstitutionId(
        req.storeId,
        c.sourceProductId,
        c.substituteProductId,
        c.needUnitId,
        input.digest,
      ),
      old = input.existing.find((m) => m.id === id);
    if (
      old &&
      (old.storeId !== req.storeId ||
        old.sourceProductId !== c.sourceProductId ||
        old.substituteProductId !== c.substituteProductId ||
        old.needUnitId !== c.needUnitId)
    )
      throw Error("PRODUCT_SUBSTITUTION_IDENTITY_CHANGED");
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
    const value = productSubstitutionSchema.parse({
      ...c,
      observedSubstitution: old?.observedSubstitution ?? null,
      relationshipScore: old?.relationshipScore ?? null,
      confidence: old?.confidence ?? null,
      evidenceCount: old?.evidenceCount ?? 0,
      lastEvidenceAt: old?.lastEvidenceAt ?? null,
      id,
      storeId: req.storeId,
      source: old?.source ?? (input.actor === "AI" ? "AI_PROPOSED" : "MANUAL"),
      status:
        {
          PROPOSE: "PROPOSED",
          VALIDATE: "VALIDATED",
          REJECT: "REJECTED",
        }[input.decision] === "VALIDATED" && old?.status === "LEARNING"
          ? "LEARNING"
          : { PROPOSE: "PROPOSED", VALIDATE: "VALIDATED", REJECT: "REJECTED" }[
              input.decision
            ],
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
      sameSubstitutionValues(old, value)
    ) {
      skipped.push({ ...c, reason: "UNCHANGED" });
      continue;
    }
    prepared.push(value);
  }
  return { prepared, skipped };
}
