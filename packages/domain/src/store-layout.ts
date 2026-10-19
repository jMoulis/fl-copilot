import { z } from "zod";
const id = z.uuid(),
  time = z.string().datetime(),
  label = z.string().trim().min(1).max(120);
export const layoutMeasurementSchema = z
  .strictObject({
    mm: z.number().int().min(0).max(100_000).nullable(),
    quality: z.enum(["UNKNOWN", "REFERENCE", "DECLARED", "MEASURED"]),
  })
  .refine((m) => (m.mm === null) === (m.quality === "UNKNOWN"));
const measure = layoutMeasurementSchema;
const dimensions = z.strictObject({
  width: measure,
  depth: measure,
  height: measure,
});
export const storeLayoutContentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    provenance: z.strictObject({
      kind: z.enum(["FLEG_REFERENCE", "USER"]),
      reference: z.string().min(1).max(300).nullable(),
    }),
    room: z.strictObject({ width: measure, depth: measure }),
    assemblies: z
      .array(
        z.strictObject({
          id,
          label,
          sourceKey: z.string().min(1).max(120).nullable(),
          x: measure,
          y: measure,
          rotation: z
            .union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ])
            .nullable(),
          dimensions,
        }),
      )
      .max(32),
    furniture: z
      .array(
        z.strictObject({
          id,
          label,
          kind: z.enum(["FIXED", "TG", "MOBILE"]),
          assemblyId: id.nullable(),
          face: z.enum(["A", "B"]).nullable(),
          order: z.number().int().min(1).max(64).nullable(),
          hostId: id.nullable(),
          x: measure,
          y: measure,
          rotation: z
            .union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ])
            .nullable(),
          dimensions,
          clearanceBelow: measure,
          sourceKey: z.string().min(1).max(120).nullable(),
        }),
      )
      .max(128),
    surfaces: z
      .array(
        z.strictObject({
          id,
          furnitureId: id,
          kind: z.enum(["BAC", "UPPER_SHELF", "MOBILE_DISPLAY", "OTHER"]),
          label,
          dimensions,
          maxLoadKg: z.number().finite().min(0).max(100_000).nullable(),
        }),
      )
      .max(384),
  })
  .superRefine((c, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const ids = [...c.assemblies, ...c.furniture, ...c.surfaces].map(
      (v) => v.id,
    );
    if (new Set(ids).size !== ids.length)
      invalid("Les identités du plan doivent être distinctes.");
    const slots = new Set<string>();
    for (const f of c.furniture) {
      if (f.kind === "FIXED") {
        if (
          !f.assemblyId ||
          !c.assemblies.some((a) => a.id === f.assemblyId) ||
          !f.face ||
          !f.order ||
          f.hostId
        )
          invalid(
            "Un élément fixe appartient à une face et une position d’un îlot.",
          );
        const slot = JSON.stringify([f.assemblyId, f.face, f.order]);
        if (slots.has(slot))
          invalid("Deux éléments occupent la même position de face.");
        slots.add(slot);
      } else if (f.assemblyId || f.face || f.order !== null)
        invalid("TG et mobiles ont une identité séparée des éléments de face.");
      if (f.kind !== "MOBILE" && f.hostId)
        invalid("Seul un mobile peut être associé sous un élément.");
      if (
        f.hostId &&
        !c.furniture.some((h) => h.id === f.hostId && h.kind !== "MOBILE")
      )
        invalid("Le meuble associé au mobile est absent ou invalide.");
      for (const m of Object.values(f.dimensions))
        if (m.mm === 0)
          invalid("Une dimension physique connue doit être positive.");
      const own = c.surfaces.filter((s) => s.furnitureId === f.id);
      if (
        f.kind === "FIXED" &&
        (own.length !== 2 ||
          !own.some((s) => s.kind === "BAC") ||
          !own.some((s) => s.kind === "UPPER_SHELF"))
      )
        invalid(
          "Chaque élément fixe possède son bac et sa propre étagère supérieure.",
        );
      if (
        f.kind === "MOBILE" &&
        (own.length !== 1 || own[0]?.kind !== "MOBILE_DISPLAY")
      )
        invalid("Un mobile possède sa propre surface de vente.");
    }
    for (const s of c.surfaces) {
      if (!c.furniture.some((f) => f.id === s.furnitureId))
        invalid("Une surface appartient à un meuble du plan.");
      for (const m of Object.values(s.dimensions))
        if (m.mm === 0)
          invalid("Une dimension de vente connue doit être positive.");
    }
    for (const a of c.assemblies)
      for (const m of Object.values(a.dimensions))
        if (m.mm === 0)
          invalid("Une dimension d’îlot connue doit être positive.");
    for (const m of Object.values(c.room))
      if (m.mm === 0)
        invalid("La zone connue doit avoir des dimensions positives.");
    if (c.provenance.kind === "FLEG_REFERENCE" && !c.provenance.reference)
      invalid("La référence fleg doit conserver sa provenance.");
  });
export type StoreLayoutContent = z.infer<typeof storeLayoutContentSchema>;
export const storeLayoutActionSchema = z.enum([
  "SAVE_DRAFT",
  "ADOPT_REFERENCE",
  "DISCARD_DRAFT",
  "RESTORE_AS_DRAFT",
]);
export const storeLayoutSchema = z
  .strictObject({
    id,
    storeId: id,
    revisionId: id,
    parentRevisionId: id.nullable(),
    referenceRevisionId: id.nullable(),
    restoredFromRevisionId: id.nullable(),
    action: storeLayoutActionSchema,
    content: storeLayoutContentSchema,
    version: z.number().int().positive(),
    createdAt: time,
    updatedAt: time,
    updatedBy: id,
  })
  .superRefine((p, c) => {
    if (
      p.id !== p.storeId ||
      (p.version === 1) !== (p.parentRevisionId === null) ||
      p.parentRevisionId === p.revisionId ||
      Date.parse(p.updatedAt) < Date.parse(p.createdAt)
    )
      c.addIssue({
        code: "custom",
        message: "Identité ou historique du plan invalide.",
      });
    if (
      (p.action === "ADOPT_REFERENCE") !==
        (p.referenceRevisionId === p.revisionId) ||
      (p.action === "RESTORE_AS_DRAFT") !== (p.restoredFromRevisionId !== null)
    )
      c.addIssue({
        code: "custom",
        message: "L’action doit conserver ses références exactes.",
      });
  });
export type StoreLayout = z.infer<typeof storeLayoutSchema>;
export const storeLayoutRevisionSchema = z
  .strictObject({
    id,
    storeId: id,
    plan: storeLayoutSchema,
    version: z.literal(1),
  })
  .refine((r) => r.id === r.plan.revisionId && r.storeId === r.plan.storeId);
export const isLayoutDraft = (p: StoreLayout) =>
  p.action === "SAVE_DRAFT" || p.action === "RESTORE_AS_DRAFT";
export function validateStoreLayoutTransition(
  previous: StoreLayout | null,
  next: StoreLayout,
  source: StoreLayout | null = null,
) {
  const n = storeLayoutSchema.parse(next),
    p = previous ? storeLayoutSchema.parse(previous) : null;
  if (
    n.version !== (p?.version ?? 0) + 1 ||
    n.parentRevisionId !== (p?.revisionId ?? null) ||
    (p &&
      (n.storeId !== p.storeId ||
        n.createdAt !== p.createdAt ||
        Date.parse(n.updatedAt) < Date.parse(p.updatedAt)))
  )
    throw Error("STORE_LAYOUT_REVISION_INVALID");
  if (
    n.action !== "ADOPT_REFERENCE" &&
    n.referenceRevisionId !== (p?.referenceRevisionId ?? null)
  )
    throw Error("STORE_LAYOUT_REFERENCE_CHANGED");
  if (
    n.action === "ADOPT_REFERENCE" &&
    (!p ||
      !isLayoutDraft(p) ||
      JSON.stringify(n.content) !== JSON.stringify(p.content))
  )
    throw Error("STORE_LAYOUT_REVIEW_REQUIRED");
  if (
    n.action === "DISCARD_DRAFT" &&
    (!p ||
      !isLayoutDraft(p) ||
      JSON.stringify(n.content) !== JSON.stringify(p.content))
  )
    throw Error("STORE_LAYOUT_REVIEW_REQUIRED");
  if (
    n.action === "RESTORE_AS_DRAFT" &&
    (!source ||
      source.storeId !== n.storeId ||
      source.revisionId !== n.restoredFromRevisionId ||
      source.version >= (p?.version ?? 0) + 1 ||
      JSON.stringify(source.content) !== JSON.stringify(n.content))
  )
    throw Error("STORE_LAYOUT_RESTORE_INVALID");
  return n;
}
