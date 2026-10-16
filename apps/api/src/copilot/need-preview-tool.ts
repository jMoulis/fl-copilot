import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotNeedProposalInputSchema,
  copilotNeedPreviewSchema,
  validateNeedProposalBasis,
  prepareNeedProposalRequest,
  needProposalUnchanged,
  needProposalRefused,
  needMembershipId,
  productSubstitutionId,
} from "@fl-copilot/domain";
import { serializeNeedUnit, type NeedUnitDocument } from "../need-unit-sync.js";
import {
  serializeNeedMembership,
  type NeedMembershipDocument,
} from "../need-membership-sync.js";
import {
  serializeProductSubstitution,
  type ProductSubstitutionDocument,
} from "../product-substitution-sync.js";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
const digest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function readNeedPreview(db: Db, storeId: string, raw: unknown) {
  z.uuid().parse(storeId);
  const input = copilotNeedProposalInputSchema.parse(raw);
  const needRow = input.needUnitId
    ? await db
        .collection<NeedUnitDocument>("needUnits")
        .findOne({ _id: input.needUnitId, storeId }, { maxTimeMS: 2000 })
    : null;
  const need = needRow ? serializeNeedUnit(needRow) : null;
  const product = async (id: string) => {
    const row = await db
      .collection<ProductDocument>("products")
      .findOne({ _id: id, storeId }, { maxTimeMS: 2000 });
    return row ? serializeProductDocument(row) : null;
  };
  const [p, t] =
    input.kind !== "NEED"
      ? await Promise.all([
          product(input.productId),
          input.kind === "SUBSTITUTION"
            ? product(input.substituteProductId)
            : null,
        ])
      : [null, null];
  const membershipId =
    input.kind === "MEMBERSHIP"
      ? await needMembershipId(
          storeId,
          input.productId,
          input.needUnitId!,
          digest,
        )
      : null;
  const substitutionId =
    input.kind === "SUBSTITUTION"
      ? await productSubstitutionId(
          storeId,
          input.productId,
          input.substituteProductId,
          input.needUnitId!,
          digest,
        )
      : null;
  const m = membershipId
    ? await db
        .collection<NeedMembershipDocument>("needMemberships")
        .findOne({ _id: membershipId, storeId }, { maxTimeMS: 2000 })
    : null;
  const s = substitutionId
    ? await db
        .collection<ProductSubstitutionDocument>("productSubstitutions")
        .findOne({ _id: substitutionId, storeId }, { maxTimeMS: 2000 })
    : null;
  const basis = {
    need,
    product: p,
    substitute: t,
    membership: m ? serializeNeedMembership(m) : null,
    substitution: s ? serializeProductSubstitution(s) : null,
  };
  let status:
    | "READY"
    | "INSPECTED"
    | "UNCHANGED"
    | "UNAVAILABLE"
    | "NEEDS_INFORMATION"
    | "BLOCKED" = "READY";
  let missingFields: string[] = [];
  try {
    validateNeedProposalBasis(storeId, input, basis);
  } catch {
    status = "UNAVAILABLE";
  }
  if (status === "READY" && input.action === "INSPECT") status = "INSPECTED";
  if (status === "READY") {
    try {
      const r = prepareNeedProposalRequest(
        input,
        basis,
        "00000000-0000-4000-8000-000000000001",
      );
      if (
        r.tool !== "need.save" &&
        r.input.decision !== "REJECTED" &&
        (need?.status !== "ACTIVE" ||
          p?.status !== "ACTIVE" ||
          p?.deletedAt ||
          (t && (t.status !== "ACTIVE" || t.deletedAt)))
      )
        status = "BLOCKED";
      if (
        r.tool === "need.membership" &&
        basis.membership &&
        basis.membership.source !== "MANUAL" &&
        r.input.declaredConfidence !== null &&
        r.input.declaredConfidence !== basis.membership.confidence
      )
        status = "BLOCKED";
      if (
        r.tool === "need.save" &&
        !basis.need &&
        (await db
          .collection<NeedUnitDocument>("needUnits")
          .findOne({ storeId, code: r.input.code }, { maxTimeMS: 2000 }))
      )
        status = "BLOCKED";
      if (status === "READY" && needProposalUnchanged(input, basis))
        status = "UNCHANGED";
    } catch (e) {
      if (e instanceof z.ZodError) {
        status = "NEEDS_INFORMATION";
        missingFields = [
          ...new Set(e.issues.map((i) => String(i.path.at(-1) ?? "name"))),
        ].slice(0, 12);
      } else status = "BLOCKED";
    }
  }
  const h = await digest(JSON.stringify([storeId, input, basis, status]));
  return copilotNeedPreviewSchema.parse({
    input,
    status,
    basis,
    missingFields,
    evidence: [
      {
        id: `need-preview/${h}`,
        sourceType: "DATA_QUALITY",
        sourceId: input.needUnitId ?? storeId,
        sourceVersion: need?.version ?? null,
        label: "Besoin client et associations",
        value:
          status === "READY"
            ? `Proposition préparée, à confirmer ; aucune donnée enregistrée.${needProposalRefused(input, basis) ? " Relation déjà refusée : réactivation humaine explicite requise." : ""} Compatibilités et niveaux proposés ne sont pas des scores appris.`
            : status === "INSPECTED"
              ? "État synchronisé consulté sans modification. Les refus et valeurs apprises restent conservés."
              : status === "UNCHANGED"
                ? "Ces valeurs sont déjà enregistrées ; aucune modification."
                : status === "NEEDS_INFORMATION"
                  ? `Informations à préciser avant proposition : ${missingFields.join(", ")}.`
                  : "Cible indisponible ou action bloquée : vérifier les besoins/produits actifs, les codes réservés et les valeurs existantes.",
        factKind: "QUALITY",
      },
    ],
  });
}
