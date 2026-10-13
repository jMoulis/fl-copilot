import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import {
  copilotNeedCatalogueInputSchema,
  copilotNeedCatalogueResultSchema,
  copilotNeedMembershipInputSchema,
  copilotNeedMembershipResultSchema,
  copilotEvidenceSchema,
} from "@fl-copilot/domain";
import { serializeNeedUnit, type NeedUnitDocument } from "../need-unit-sync.js";
import {
  serializeNeedMembership,
  type NeedMembershipDocument,
} from "../need-membership-sync.js";
import {
  serializeProductDocument,
  type ProductDocument,
} from "../products/product-master.js";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const states = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  TO_REVIEW: "À examiner",
};
export async function readNeedCatalogue(db: Db, storeId: string, raw: unknown) {
  z.string().uuid().parse(storeId);
  const input = copilotNeedCatalogueInputSchema.parse(raw);
  const rows = await db
    .collection<NeedUnitDocument>("needUnits")
    .find({
      storeId,
      ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const parsed = rows.map((row) => {
    const n = serializeNeedUnit(row);
    if (
      n.id !== row._id ||
      n.storeId !== storeId ||
      (input.afterId && n.id <= input.afterId)
    )
      throw Error("COPILOT_NEED_SCOPE_INVALID");
    return n;
  });
  const needs = parsed.slice(0, input.limit),
    nextAfterId = parsed.length > input.limit ? needs.at(-1)!.id : null;
  const revision = hash([storeId, input, needs, nextAfterId]);
  const evidence = needs.map((n) =>
    copilotEvidenceSchema.parse({
      id: `need-catalogue/${revision}/${n.id}`,
      sourceType: "DATA_QUALITY",
      sourceId: n.id,
      sourceVersion: n.version,
      label: `Besoin client enregistré — ${n.name}`,
      value: `${states[n.status]} ; code ${n.code}. ${n.description ?? "Description non précisée."} Origine ${n.createdBy === "USER" ? "utilisateur" : n.createdBy === "AI" ? "IA" : "système"}. Un besoin client n'est pas une quantité à commander ni une unité de vente. Il ne prouve pas un comportement d'achat mesuré.`,
      factKind: "QUALITY",
    }),
  );
  evidence.push(
    copilotEvidenceSchema.parse({
      id: `need-catalogue-coverage/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: "Couverture du référentiel des besoins",
      value: `${needs.length} besoins dans cette page${nextAfterId ? ", autres pages non consultées" : " ; fin des besoins enregistrés dans ce périmètre"}. Les besoins inactifs ou à examiner restent distincts des besoins actifs. Une absence dans ce référentiel ne prouve pas l'absence d'un besoin client.`,
      factKind: "QUALITY",
    }),
  );
  return copilotNeedCatalogueResultSchema.parse({
    needs,
    nextAfterId,
    evidence,
  });
}
export async function readNeedMemberships(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  z.string().uuid().parse(storeId);
  const input = copilotNeedMembershipInputSchema.parse(raw);
  const scopes = await Promise.all([
    input.needUnitId
      ? db
          .collection<NeedUnitDocument>("needUnits")
          .findOne({ _id: input.needUnitId, storeId }, { maxTimeMS: 2000 })
      : Promise.resolve(true),
    input.productId
      ? db
          .collection<ProductDocument>("products")
          .findOne({ _id: input.productId, storeId }, { maxTimeMS: 2000 })
      : Promise.resolve(true),
  ]);
  if (scopes.some((s) => !s)) throw Error("COPILOT_NEED_PARENT_UNAVAILABLE");
  const rows = await db
    .collection<NeedMembershipDocument>("needMemberships")
    .find({
      storeId,
      ...(input.needUnitId ? { needUnitId: input.needUnitId } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.afterId ? { _id: { $gt: input.afterId } } : {}),
    })
    .sort({ _id: 1 })
    .maxTimeMS(2000)
    .limit(input.limit + 1)
    .toArray();
  const parsed = rows.map((row) => {
    const m = serializeNeedMembership(row);
    if (
      row._id !== m.id ||
      m.storeId !== storeId ||
      (input.needUnitId && m.needUnitId !== input.needUnitId) ||
      (input.productId && m.productId !== input.productId) ||
      (input.afterId && m.id <= input.afterId)
    )
      throw Error("COPILOT_NEED_SCOPE_INVALID");
    return m;
  });
  const page = parsed.slice(0, input.limit),
    productIds = [...new Set(page.map((m) => m.productId))],
    needIds = [...new Set(page.map((m) => m.needUnitId))];
  const [products, needs] = await Promise.all([
    db
      .collection<ProductDocument>("products")
      .find({ storeId, _id: { $in: productIds } })
      .maxTimeMS(2000)
      .limit(10)
      .toArray(),
    db
      .collection<NeedUnitDocument>("needUnits")
      .find({ storeId, _id: { $in: needIds } })
      .maxTimeMS(2000)
      .limit(10)
      .toArray(),
  ]);
  const catalogue = products.map(serializeProductDocument),
    needCatalogue = needs.map((row) => {
      const n = serializeNeedUnit(row);
      if (n.id !== row._id) throw Error("COPILOT_NEED_SCOPE_INVALID");
      return n;
    });
  if (
    catalogue.some(
      (p) => p.storeId !== storeId || !productIds.includes(p.id),
    ) ||
    needCatalogue.some((n) => n.storeId !== storeId || !needIds.includes(n.id))
  )
    throw Error("COPILOT_NEED_SCOPE_INVALID");
  const memberships = page.map((entity) => ({
    entity,
    product: catalogue.find((p) => p.id === entity.productId) ?? null,
    need: needCatalogue.find((n) => n.id === entity.needUnitId) ?? null,
  }));
  const nextAfterId = parsed.length > input.limit ? page.at(-1)!.id : null;
  const revision = hash([storeId, input, memberships, nextAfterId]);
  const sources = {
    MANUAL: "Manuelle",
    AI_PROPOSED: "Proposée par l'IA",
    LEARNED: "Issue de l'apprentissage enregistré",
  };
  const statuses = {
    VALIDATED: "Validée",
    PROPOSED: "Proposée, à confirmer",
    REJECTED: "Refusée",
  };
  const evidence = memberships.map(({ entity: m, product: p, need: n }) =>
    copilotEvidenceSchema.parse({
      id: `need-membership/${revision}/${m.id}`,
      sourceType: "DATA_QUALITY",
      sourceId: m.id,
      sourceVersion: m.version,
      label: `Association enregistrée — ${p?.label ?? "Produit indisponible"} / ${n?.name ?? "Besoin indisponible"}`,
      value: `${statuses[m.status]} ; confirmation humaine ${m.humanConfirmed ? "enregistrée" : "absente"}. Origine : ${sources[m.source]}. Force d'appartenance enregistrée ${m.strength}, confiance de classification ${m.confidence}, besoin principal ${m.primary ? "oui" : "non"}. Produit ${p ? (p.deletedAt ? "retiré" : states[p.status]) : "indisponible"}, besoin ${n ? states[n.status] : "indisponible"}. Ces niveaux ne sont ni une probabilité d'achat, ni la certitude de la réponse IA. Un besoin partagé ne crée pas une relation de substitution dirigée ni une preuve d'achats conjoints. Les propositions, refus et parents inactifs/indisponibles ne doivent pas être présentés comme des associations actives validées.`,
      factKind: "QUALITY",
    }),
  );
  evidence.push(
    copilotEvidenceSchema.parse({
      id: `need-membership-coverage/${revision}`,
      sourceType: "DATA_QUALITY",
      sourceId: storeId,
      sourceVersion: null,
      label: "Couverture des associations de besoins",
      value: `${memberships.length} associations dans cette page${nextAfterId ? ", autres pages non consultées" : " ; fin des associations enregistrées pour ce périmètre"}. Tous les statuts sont conservés, les refus ne sont pas réactivés. Une absence d'association ne prouve pas l'absence d'un usage client. Aucune association ni classification n'a été modifiée.`,
      factKind: "QUALITY",
    }),
  );
  return copilotNeedMembershipResultSchema.parse({
    needUnitId: input.needUnitId,
    productId: input.productId,
    memberships,
    nextAfterId,
    evidence,
  });
}
