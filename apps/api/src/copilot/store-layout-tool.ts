import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  copilotEvidenceSchema,
  copilotStoreLayoutInputSchema,
  isLayoutDraft,
  storeLayoutSchema,
  storeLayoutContentSchema,
  storeLayoutGeometryIssueSchema,
  type StoreLayoutContent,
} from "@fl-copilot/domain";
import { checkStoreLayoutGeometry } from "@fl-copilot/commercial-core";
import {
  serializeStoreLayout,
  serializeStoreLayoutRevision,
  type StoreLayoutDocument,
  type StoreLayoutRevisionDocument,
} from "../store-layout-sync";

export const storeLayoutReadSnapshotSchema = z.strictObject({
  head: storeLayoutSchema.nullable(),
  reference: storeLayoutSchema.nullable(),
});
const shape = storeLayoutContentSchema.shape;
const recordSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ASSEMBLY"),
    entity: shape.assemblies.element,
  }),
  z.strictObject({
    type: z.literal("FURNITURE"),
    entity: shape.furniture.element,
  }),
  z.strictObject({
    type: z.literal("SURFACE"),
    entity: shape.surfaces.element,
  }),
]);
type Record = z.infer<typeof recordSchema>;
export const storeLayoutToolResultSchema = z.strictObject({
  storeId: z.uuid(),
  input: copilotStoreLayoutInputSchema,
  status: z.enum([
    "READY",
    "ABSENT",
    "NO_REFERENCE",
    "NO_DRAFT",
    "STALE",
    "TARGET_NOT_FOUND",
    "CURSOR_INVALID",
  ]),
  head: z
    .strictObject({
      revisionId: z.uuid(),
      version: z.number().int().positive(),
      action: storeLayoutSchema.shape.action,
      referenceRevisionId: z.uuid().nullable(),
      draftAvailable: z.boolean(),
    })
    .nullable(),
  selected: z
    .strictObject({
      revisionId: z.uuid(),
      version: z.number().int().positive(),
      updatedAt: z.iso.datetime(),
      action: storeLayoutSchema.shape.action,
      provenance: shape.provenance,
    })
    .nullable(),
  room: shape.room.nullable(),
  assemblies: shape.assemblies,
  target: recordSchema.nullable(),
  items: z.array(recordSchema).max(20),
  nextCursor: z.uuid().nullable(),
  surfaces: z
    .array(
      z.strictObject({
        furnitureId: z.uuid(),
        count: z.number().int().min(0).max(384),
        kinds: z.array(shape.surfaces.element.shape.kind).max(4),
      }),
    )
    .max(20),
  geometry: z
    .strictObject({
      status: z.enum(["CHECKED", "INCOMPLETE", "BLOCKED"]),
      counts: z.strictObject({
        assemblies: z.number().int(),
        furniture: z.number().int(),
        fixed: z.number().int(),
        tg: z.number().int(),
        mobiles: z.number().int(),
        located: z.number().int(),
        surfaces: z.number().int(),
      }),
      blocking: z.number().int().min(0),
      missing: z.number().int().min(0),
      notices: z.number().int().min(0),
      relevantCount: z.number().int().min(0),
      issues: z.array(storeLayoutGeometryIssueSchema).max(10),
      issuesTruncated: z.boolean(),
    })
    .nullable(),
  evidence: z.array(copilotEvidenceSchema).min(1).max(24),
});

/** Server-private snapshot. Do not pass the full canonical content directly to the model. */
export async function readCopilotStoreLayoutSnapshot(db: Db, storeId: string) {
  z.uuid().parse(storeId);
  const collection = db.collection<StoreLayoutDocument>("storeLayouts");
  const row = await collection.findOne(
    { _id: storeId, storeId },
    { maxTimeMS: 2000 },
  );
  if (!row) return { head: null, reference: null };
  const head = serializeStoreLayout(row);
  if (row._id !== storeId || head.id !== storeId || head.storeId !== storeId)
    throw Error("STORE_LAYOUT_SCOPE_INVALID");
  if (!head.referenceRevisionId) return { head, reference: null };
  if (head.referenceRevisionId === head.revisionId)
    return { head, reference: head };
  const historical = await db
    .collection<StoreLayoutRevisionDocument>("storeLayoutRevisions")
    .findOne({ _id: head.referenceRevisionId, storeId }, { maxTimeMS: 2000 });
  if (!historical) throw Error("STORE_LAYOUT_REFERENCE_UNAVAILABLE");
  const reference = serializeStoreLayoutRevision(historical).plan;
  const fresh = await collection.findOne(
    { _id: storeId, storeId },
    { projection: { revisionId: 1 }, maxTimeMS: 2000 },
  );
  if (fresh?.revisionId !== head.revisionId)
    throw Error("STORE_LAYOUT_SOURCE_CHANGED");
  return { head, reference };
}

/** Revalidate scope and derive only the requested page, qualification and citations. No business write. */
export function presentCopilotStoreLayout(
  storeId: string,
  rawInput: unknown,
  rawSnapshot: unknown,
) {
  z.uuid().parse(storeId);
  const input = copilotStoreLayoutInputSchema.parse(rawInput),
    { head, reference } = storeLayoutReadSnapshotSchema.parse(rawSnapshot);
  if (
    (head && (head.storeId !== storeId || head.id !== storeId)) ||
    (reference &&
      (!head ||
        reference.storeId !== storeId ||
        reference.id !== storeId ||
        reference.revisionId !== head.referenceRevisionId ||
        reference.action !== "ADOPT_REFERENCE" ||
        reference.version > head.version ||
        reference.createdAt !== head.createdAt)) ||
    (head?.referenceRevisionId && !reference)
  )
    throw Error("STORE_LAYOUT_SCOPE_INVALID");
  if (
    head &&
    reference &&
    ((reference.version >= head.version &&
      reference.revisionId !== head.revisionId) ||
      (reference.revisionId === head.revisionId &&
        JSON.stringify(reference) !== JSON.stringify(head)))
  )
    throw Error("STORE_LAYOUT_REFERENCE_INVALID");
  const selected =
    input.view === "REFERENCE"
      ? reference
      : head && isLayoutDraft(head)
        ? head
        : null;
  const c = selected?.content;
  let status: z.infer<typeof storeLayoutToolResultSchema>["status"] = !head
    ? "ABSENT"
    : !selected
      ? input.view === "REFERENCE"
        ? "NO_REFERENCE"
        : "NO_DRAFT"
      : input.expectedRevisionId &&
          input.expectedRevisionId !== selected.revisionId
        ? "STALE"
        : "READY";
  const records: Record[] = c
    ? [
        ...c.assemblies.map((entity) => ({
          type: "ASSEMBLY" as const,
          entity,
        })),
        ...c.furniture.map((entity) => ({
          type: "FURNITURE" as const,
          entity,
        })),
        ...c.surfaces.map((entity) => ({ type: "SURFACE" as const, entity })),
      ]
    : [];
  const target =
    input.targetId && status === "READY"
      ? (records.find((r) => r.entity.id === input.targetId) ?? null)
      : null;
  if (status === "READY" && input.targetId && !target)
    status = "TARGET_NOT_FOUND";
  let eligible =
    status !== "READY"
      ? []
      : !target
        ? records.filter((r) => r.type === "FURNITURE")
        : target.type === "ASSEMBLY"
          ? records.filter(
              (r) =>
                r.type === "FURNITURE" &&
                r.entity.assemblyId === target.entity.id,
            )
          : target.type === "FURNITURE"
            ? records.filter(
                (r) =>
                  (r.type === "SURFACE" &&
                    r.entity.furnitureId === target.entity.id) ||
                  (r.type === "FURNITURE" &&
                    r.entity.hostId === target.entity.id),
              )
            : [];
  eligible = eligible.sort((a, b) =>
    a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0,
  );
  if (input.cursor && status === "READY") {
    const at = eligible.findIndex((r) => r.entity.id === input.cursor);
    if (at < 0) {
      status = "CURSOR_INVALID";
      eligible = [];
    } else eligible = eligible.slice(at + 1);
  }
  const items = eligible.slice(0, input.limit),
    ready = status === "READY",
    geometry = ready && c ? checkStoreLayoutGeometry(c) : null;
  const relevant =
    geometry?.issues.filter(
      (i) =>
        !target ||
        i.targets.includes(target.entity.id) ||
        (target.type === "SURFACE" &&
          i.targets.includes(target.entity.furnitureId)),
    ) ?? [];
  const prioritized = [
    ...relevant.filter((i) => i.severity === "BLOCKING"),
    ...relevant.filter((i) => i.severity === "MISSING"),
    ...relevant.filter((i) => i.severity === "NOTICE"),
  ];
  const geometrySummary = geometry
    ? {
        status: geometry.status,
        counts: { ...geometry.counts, surfaces: c!.surfaces.length },
        blocking: geometry.issues.filter((i) => i.severity === "BLOCKING")
          .length,
        missing: geometry.issues.filter((i) => i.severity === "MISSING").length,
        notices: geometry.issues.filter((i) => i.severity === "NOTICE").length,
        relevantCount: relevant.length,
        issues: prioritized.slice(0, 10),
        issuesTruncated: prioritized.length > 10,
      }
    : null;
  const value = {
    storeId,
    input,
    status,
    head: head
      ? {
          revisionId: head.revisionId,
          version: head.version,
          action: head.action,
          referenceRevisionId: head.referenceRevisionId,
          draftAvailable: isLayoutDraft(head),
        }
      : null,
    selected: selected
      ? {
          revisionId: selected.revisionId,
          version: selected.version,
          updatedAt: selected.updatedAt,
          action: selected.action,
          provenance: selected.content.provenance,
        }
      : null,
    room: ready ? c!.room : null,
    assemblies: ready ? c!.assemblies : [],
    target: ready ? target : null,
    items: ready ? items : [],
    nextCursor:
      ready && eligible.length > input.limit ? items.at(-1)!.entity.id : null,
    surfaces: ready
      ? items
          .filter((r) => r.type === "FURNITURE")
          .map((r) => {
            const own = c!.surfaces.filter(
              (s) => s.furnitureId === r.entity.id,
            );
            return {
              furnitureId: r.entity.id,
              count: own.length,
              kinds: [...new Set(own.map((s) => s.kind))],
            };
          })
      : [],
    geometry: geometrySummary,
  };
  const digest = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex"),
    sourceId = selected?.revisionId ?? head?.revisionId ?? storeId;
  const rows = [
    {
      label:
        input.view === "REFERENCE"
          ? "Plan physique de référence du magasin"
          : "Brouillon physique du magasin",
      value: ready
        ? `${input.view === "REFERENCE" ? "Référence adoptée" : "Brouillon non adopté"} · version ${selected!.version}. ${geometry!.counts.furniture} éléments, dont ${geometry!.counts.tg} TG et ${geometry!.counts.mobiles} mobiles ; ${c!.assemblies.length} îlots et ${c!.surfaces.length} surfaces distinctes.`
        : {
            ABSENT:
              "Aucun plan synchronisé disponible. Un plan local non synchronisé peut exister.",
            NO_REFERENCE:
              "Aucune référence adoptée synchronisée. Un brouillon existe peut-être ; il ne remplace pas un plan adopté.",
            NO_DRAFT:
              "Aucun brouillon actif synchronisé. Une version abandonnée n’est pas réactivée.",
            STALE:
              "La révision sélectionnée a changé ; recommencez la lecture avant de poursuivre la pagination.",
            TARGET_NOT_FOUND:
              "L’élément demandé n’est pas présent dans cette version du magasin.",
            CURSOR_INVALID:
              "Le repère de pagination n’appartient pas à cette sélection ; recommencez sans curseur.",
            READY: "",
          }[status],
      detail:
        "Plan synchronisé du magasin, pas une preuve de réalisation terrain ; les modifications locales non envoyées sont inconnues. Les positions du mobilier restent fixes dans une proposition commerciale courante. Données physiques distinctes des affectations de produits et des idées du PDF. Les valeurs à confirmer ne deviennent pas des relevés ; aucune capacité, charge, stock ou faisabilité globale n’est déduite. Cette lecture n’enregistre aucune modification.",
    },
  ];
  if (ready) {
    rows.push({
      label: "Dimensions du rayon",
      value: `Largeur ${measureDescription(c!.room.width)} ; profondeur ${measureDescription(c!.room.depth)}.`,
      detail:
        "Dimensions enregistrées dans cette révision physique, distinctes des surfaces de vente et de leur capacité.",
    });
    rows.push({
      label: "Contrôle provisoire du plan",
      value: `${{ CHECKED: "Aucune incompatibilité détectée sur les emprises renseignées", INCOMPLETE: "Mesures à compléter ou confirmer", BLOCKED: "Emprises à corriger" }[geometrySummary!.status]} · ${geometrySummary!.blocking} incompatibilités, ${geometrySummary!.missing} informations à compléter/confirmer. ${geometrySummary!.issues.map((i) => i.message).join(" ")}${geometrySummary!.issuesTruncated ? " D’autres points existent ; ce relevé est partiel." : ""}`,
      detail:
        "Périmètre : emprises et hauteurs libres renseignées. Passages, obstacles, charges, stabilité et surfaces de vente non contrôlés ici. Une association de mobile ne prouve pas sa compatibilité sous le meuble.",
    });
    for (const r of [...(target ? [target] : []), ...items])
      rows.push({
        label: r.entity.label,
        value: recordDescription(r, c!),
        detail:
          "Valeurs de cette révision physique ; aucune action ni implantation commerciale réalisée. Les champs inconnus ne valent pas zéro.",
      });
  }
  return storeLayoutToolResultSchema.parse({
    ...value,
    evidence: rows.map((row, index) => ({
      id: `store-layout/${digest}/${index}`,
      sourceType: "DATA_QUALITY",
      sourceId,
      sourceVersion: selected?.version ?? head?.version ?? null,
      factKind: "QUALITY",
      ...row,
    })),
  });
}

function recordDescription(r: Record, c: StoreLayoutContent) {
  const m = measureDescription;
  const e = r.entity;
  let text = `Largeur ${m(e.dimensions.width)} ; profondeur ${m(e.dimensions.depth)} ; hauteur ${m(e.dimensions.height)}.`;
  if (r.type !== "SURFACE")
    text += ` Position depuis la gauche ${m(r.entity.x)}, depuis le haut ${m(r.entity.y)} ; orientation ${r.entity.rotation === null ? "inconnue" : `${r.entity.rotation}°`}.`;
  if (r.type === "FURNITURE") {
    const f = r.entity;
    text += ` ${f.kind === "MOBILE" ? "Mobile de vente" : f.kind === "TG" ? "TG" : "Élément fixe"}.`;
    if (f.assemblyId)
      text += ` ${c.assemblies.find((a) => a.id === f.assemblyId)?.label}, face ${f.face}, élément ${f.order}.`;
    if (f.hostId)
      text += ` Habituellement sous ${c.furniture.find((h) => h.id === f.hostId)?.label}, compatibilité non déduite.`;
    const own = c.surfaces.filter((s) => s.furnitureId === f.id);
    text += ` ${own.length} surfaces propres. Hauteur libre ${m(f.clearanceBelow)}.`;
  } else if (r.type === "SURFACE")
    text += ` Surface propre de ${c.furniture.find((f) => f.id === r.entity.furnitureId)?.label}. Charge maximale ${r.entity.maxLoadKg === null ? "inconnue" : `${r.entity.maxLoadKg} kg`}, sans charge réelle ni stock déduits.`;
  else
    text += ` Ensemble de ${c.furniture.filter((f) => f.assemblyId === e.id).length} éléments ; l’enveloppe ne compte pas comme un meuble supplémentaire.`;
  return text;
}
function measureDescription(v: StoreLayoutContent["room"]["width"]) {
  return v.mm === null
    ? "inconnu"
    : `${v.mm / 10} cm (${v.quality === "REFERENCE" ? "référence à confirmer" : v.quality === "MEASURED" ? "relevé sur place" : "déclaré"})`;
}
