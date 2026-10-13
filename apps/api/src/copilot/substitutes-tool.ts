import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import { lookupSubstitutes } from "@fl-copilot/substitution-core";
import {
  copilotSubstitutesInputSchema,
  copilotSubstitutesResultSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
import { serializeNeedUnit, type NeedUnitDocument } from "../need-unit-sync.js";
import {
  serializeProductSubstitution,
  type ProductSubstitutionDocument,
} from "../product-substitution-sync.js";
import {
  serializeStoreProductEvent,
  type StoreProductEventDocument,
} from "../store-product-event-sync.js";

/** Reads canonical synchronized records; delegates every eligibility/ranking rule to the shared engine. */
export async function readSubstitutes(
  db: Db,
  storeId: string,
  raw: unknown,
  now = new Date().toISOString(),
) {
  z.string().uuid().parse(storeId);
  const input = copilotSubstitutesInputSchema.parse(raw);
  if (Date.parse(input.at) > Date.parse(z.string().datetime().parse(now)))
    throw Error("COPILOT_SUBSTITUTES_FUTURE");
  const rows = await db
    .collection<ProductSubstitutionDocument>("productSubstitutions")
    .find({
      storeId,
      sourceProductId: input.productId,
      ...(input.needUnitId ? { needUnitId: input.needUnitId } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(251)
    .toArray();
  const relations = rows.map((row) => {
    const entity = serializeProductSubstitution(row);
    if (
      row._id !== entity.id ||
      entity.storeId !== storeId ||
      entity.sourceProductId !== input.productId ||
      (input.needUnitId && entity.needUnitId !== input.needUnitId)
    )
      throw Error("COPILOT_SUBSTITUTES_SCOPE_INVALID");
    return { entity, syncState: "SYNCED" };
  });
  const ids = [
    ...new Set([
      input.productId,
      ...relations.map((r) => r.entity.substituteProductId),
    ]),
  ];
  const needIds = [...new Set(relations.map((r) => r.entity.needUnitId))];
  const [productRows, needRows, eventRows] = await Promise.all([
    db
      .collection<ProductDocument>("products")
      .find({ storeId, _id: { $in: ids } })
      .maxTimeMS(2000)
      .limit(252)
      .toArray(),
    db
      .collection<NeedUnitDocument>("needUnits")
      .find({ storeId, _id: { $in: needIds } })
      .maxTimeMS(2000)
      .limit(251)
      .toArray(),
    db
      .collection<StoreProductEventDocument>("storeProductEvents")
      .find({
        storeId,
        productId: { $in: ids },
        source: "USER",
        startedAt: { $lte: input.at },
        $or: [{ endedAt: null }, { endedAt: { $gt: input.at } }],
      })
      .maxTimeMS(2000)
      .limit(501)
      .toArray(),
  ]);
  const products = productRows.map((row) => {
    const entity = serializeProductDocument(row);
    if (entity.storeId !== storeId || !ids.includes(entity.id))
      throw Error("COPILOT_SUBSTITUTES_SCOPE_INVALID");
    return { entity, syncState: "SYNCED" };
  });
  const needs = needRows.map((row) => {
    const entity = serializeNeedUnit(row);
    if (
      row._id !== entity.id ||
      entity.storeId !== storeId ||
      !needIds.includes(entity.id)
    )
      throw Error("COPILOT_SUBSTITUTES_SCOPE_INVALID");
    return { entity, syncState: "SYNCED" };
  });
  const events = eventRows.map((row) => {
    const entity = serializeStoreProductEvent(row);
    if (
      row._id !== entity.id ||
      entity.storeId !== storeId ||
      !ids.includes(entity.productId)
    )
      throw Error("COPILOT_SUBSTITUTES_SCOPE_INVALID");
    return { entity, syncState: "SYNCED" };
  });
  const exceeded = rows.length > 250 || eventRows.length > 500;
  const lookup = lookupSubstitutes({
    storeId,
    productId: input.productId,
    needUnitId: input.needUnitId ?? undefined,
    at: input.at,
    products,
    needs,
    relations: exceeded ? [] : relations,
    events: exceeded ? [] : events,
  });
  const page = exceeded
    ? []
    : lookup.candidates.slice(input.offset, input.offset + input.limit);
  const candidates = page.map((c) => ({
    productId: c.productId,
    label: products.find((p) => p.entity.id === c.productId)!.entity.label,
    availability: c.availability,
    relationships: c.relationships,
    events: c.events,
  }));
  const hasMore =
    !exceeded && input.offset + candidates.length < lookup.candidates.length;
  const excluded = lookup.excluded.slice(0, 25);
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        storeId,
        input,
        products,
        needs,
        relations,
        events,
        exceeded,
      ]),
    )
    .digest("hex");
  const sourceLabel =
    products.find((p) => p.entity.id === input.productId)?.entity.label ??
    "Produit indisponible";
  const evidence = candidates.map((c) =>
    copilotEvidenceSchema.parse({
      id: `substitute/${revision}/${c.productId}`,
      sourceType: "SUBSTITUTION",
      sourceId: c.relationships[0]!.relation.id,
      sourceVersion: c.relationships[0]!.relation.version,
      label: `Alternative enregistrée — ${sourceLabel} vers ${c.label}`,
      value: `Relation dirigée, confirmée pour ${c.relationships.map((r) => needs.find((n) => n.entity.id === r.relation.needUnitId)!.entity.name).join(" ; ")}. Classement comportemental partagé : ${c.relationships.map((r) => `${r.fit} (${r.basis === "LEARNED" ? "base issue des preuves enregistrées" : "compatibilités déclarées"})`).join(" ; ")}. Disponibilité réelle inconnue ; vérifier le rayon avant d'agir. Ce classement n'est ni une prévision de ventes, ni une priorité commerciale, ni une preuve de causalité.`,
      factKind: "DERIVED",
    }),
  );
  evidence.push(
    copilotEvidenceSchema.parse({
      id: `substitute-coverage/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: input.productId,
      sourceVersion: null,
      label: `Couverture des alternatives — ${sourceLabel}`,
      value: exceeded
        ? "Limite de lecture dépassée ; résultat indisponible, aucun classement sur un échantillon."
        : `${lookup.status === "SOURCE_UNAVAILABLE" ? "Produit source indisponible." : `${lookup.candidates.length} alternatives éligibles enregistrées ; ${candidates.length} dans cette page${hasMore ? ", autres pages non consultées" : ""}.`} ${lookup.excluded.length} relations exclues selon les règles partagées. Les refus ne sont pas réactivés. Une absence de relation ne prouve pas l'absence d'alternative possible. Les relations consultées sont leur version actuellement synchronisée, pas une reconstitution historique à cet instant. Une observation ancienne non clôturée n'est pas un inventaire actuel.`,
      factKind: "QUALITY",
    }),
  );
  return copilotSubstitutesResultSchema.parse({
    tool: "substitution.lookup",
    productId: input.productId,
    needUnitId: input.needUnitId,
    evaluatedAt: lookup.evaluatedAt,
    ruleVersion: lookup.ruleVersion,
    lookupStatus: exceeded ? "LIMIT_EXCEEDED" : lookup.status,
    candidates,
    candidateCount: exceeded ? null : lookup.candidates.length,
    hasMore,
    nextOffset: hasMore ? input.offset + candidates.length : null,
    excluded,
    excludedCount: exceeded ? null : lookup.excluded.length,
    excludedHasMore: !exceeded && lookup.excluded.length > 25,
    evidence,
  });
}
