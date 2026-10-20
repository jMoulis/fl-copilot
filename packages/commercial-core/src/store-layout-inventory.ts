import {
  storeLayoutContentSchema,
  type StoreLayoutContent,
} from "@fl-copilot/domain";
import { addStoreLayoutMobile } from "./store-layout-editing";

type Content = StoreLayoutContent;
type Furniture = Content["furniture"][number];
type Measurement = Furniture["x"];
type Dimensions = Furniture["dimensions"];
export type LayoutInventoryTarget = {
  kind: "ASSEMBLY" | "FURNITURE" | "SURFACE";
  id: string;
};
export type LayoutFixedSlot = {
  assemblyId: string;
  face: "A" | "B";
  order: number;
};
export type LayoutInventoryAddition =
  | { kind: "ASSEMBLY" | "TG" | "MOBILE"; label: string }
  | ({ kind: "FIXED"; label: string } & LayoutFixedSlot);
const unknown = (): Measurement => ({ mm: null, quality: "UNKNOWN" });
const emptyDimensions = (): Dimensions => ({
  width: unknown(),
  depth: unknown(),
  height: unknown(),
});
const copyMeasure = (m: Measurement, copy: boolean): Measurement =>
  copy && m.mm !== null ? { mm: m.mm, quality: "DECLARED" } : unknown();
const copyDimensions = (d: Dimensions, copy: boolean): Dimensions => ({
  width: copyMeasure(d.width, copy),
  depth: copyMeasure(d.depth, copy),
  height: copyMeasure(d.height, copy),
});
function fixedSlot(c: Content, slot: LayoutFixedSlot) {
  if (
    !c.assemblies.some((a) => a.id === slot.assemblyId) ||
    !["A", "B"].includes(slot.face) ||
    !Number.isInteger(slot.order) ||
    slot.order < 1 ||
    slot.order > 64
  )
    throw Error("Choisissez un îlot, une face et un rang de 1 à 64.");
  if (
    c.furniture.some(
      (f) =>
        f.assemblyId === slot.assemblyId &&
        f.face === slot.face &&
        f.order === slot.order,
    )
  )
    throw Error("Ce rang de face est déjà occupé. Choisissez un autre rang.");
}

/** Inventory intent only. New furniture never inherits schematic drawing coordinates. */
export function addStoreLayoutInventory(
  input: Content,
  request: LayoutInventoryAddition,
  uuid: () => string,
): { content: Content; id: string } {
  const c = storeLayoutContentSchema.parse(input);
  if (request.kind === "MOBILE") {
    const next = addStoreLayoutMobile(c, uuid, request.label, null);
    return { content: next, id: next.furniture.at(-1)!.id };
  }
  const id = uuid();
  if (request.kind === "ASSEMBLY")
    return {
      id,
      content: storeLayoutContentSchema.parse({
        ...c,
        assemblies: [
          ...c.assemblies,
          {
            id,
            label: request.label,
            sourceKey: null,
            x: unknown(),
            y: unknown(),
            rotation: null,
            dimensions: emptyDimensions(),
          },
        ],
      }),
    };
  if (request.kind === "FIXED") fixedSlot(c, request);
  const furniture: Furniture = {
    id,
    label: request.label,
    kind: request.kind,
    assemblyId: request.kind === "FIXED" ? request.assemblyId : null,
    face: request.kind === "FIXED" ? request.face : null,
    order: request.kind === "FIXED" ? request.order : null,
    hostId: null,
    sourceKey: null,
    x: unknown(),
    y: unknown(),
    rotation: null,
    dimensions: emptyDimensions(),
    clearanceBelow: unknown(),
  };
  const surfaces =
    request.kind === "FIXED"
      ? (["BAC", "UPPER_SHELF"] as const).map((kind) => ({
          id: uuid(),
          furnitureId: id,
          kind,
          label: kind === "BAC" ? "Bac aluminium" : "Étagère supérieure",
          dimensions: emptyDimensions(),
          maxLoadKg: null,
        }))
      : [];
  return {
    id,
    content: storeLayoutContentSchema.parse({
      ...c,
      furniture: [...c.furniture, furniture],
      surfaces: [...c.surfaces, ...surfaces],
    }),
  };
}

/** A TG's composition is explicitly declared; no selling surface is inferred from its footprint. */
export function addStoreLayoutTgSurface(
  input: Content,
  furnitureId: string,
  label: string,
  kind: "BAC" | "UPPER_SHELF" | "OTHER",
  uuid: () => string,
) {
  const c = storeLayoutContentSchema.parse(input);
  if (!c.furniture.some((f) => f.id === furnitureId && f.kind === "TG"))
    throw Error("Choisissez une TG présente dans ce brouillon.");
  if (!["BAC", "UPPER_SHELF", "OTHER"].includes(kind))
    throw Error(
      "Choisissez un bac, une étagère supérieure ou une autre surface de TG.",
    );
  const id = uuid();
  return {
    id,
    content: storeLayoutContentSchema.parse({
      ...c,
      surfaces: [
        ...c.surfaces,
        {
          id,
          furnitureId,
          label,
          kind,
          dimensions: emptyDimensions(),
          maxLoadKg: null,
        },
      ],
    }),
  };
}

/** Copies structure, never physical location, measured certainty, capacity, provenance or mobiles. */
export function duplicateStoreLayoutInventory(
  input: Content,
  target: LayoutInventoryTarget,
  request: { label: string; copyDimensions: boolean; slot?: LayoutFixedSlot },
  uuid: () => string,
): { content: Content; id: string } {
  const c = storeLayoutContentSchema.parse(input),
    id = uuid();
  if (target.kind === "SURFACE")
    throw Error("Dupliquez le meuble, pas une surface obligatoire isolée.");
  const assembly =
    target.kind === "ASSEMBLY"
      ? c.assemblies.find((a) => a.id === target.id)
      : null;
  const object =
    target.kind === "FURNITURE"
      ? c.furniture.find((f) => f.id === target.id)
      : null;
  if (!assembly && !object)
    throw Error("Élément introuvable dans ce brouillon.");
  if (object?.kind === "FIXED") {
    if (!request.slot)
      throw Error(
        "Choisissez l’emplacement de ce nouvel élément dans l’inventaire.",
      );
    fixedSlot(c, request.slot);
  }
  const sourceFurniture = assembly
    ? c.furniture.filter((f) => f.assemblyId === assembly.id)
    : [object!];
  const map = new Map(
    sourceFurniture.map((f) => [f.id, assembly ? uuid() : id]),
  );
  const furniture = sourceFurniture.map((f) => ({
    ...f,
    id: map.get(f.id)!,
    label: assembly
      ? `${request.label.trim().slice(0, 75)} · Face ${f.face} · Élément ${f.order}`
      : request.label,
    sourceKey: null,
    assemblyId: assembly
      ? id
      : f.kind === "FIXED"
        ? request.slot!.assemblyId
        : null,
    face: !assembly && f.kind === "FIXED" ? request.slot!.face : f.face,
    order: !assembly && f.kind === "FIXED" ? request.slot!.order : f.order,
    hostId: null,
    x: unknown(),
    y: unknown(),
    rotation: null,
    dimensions: copyDimensions(f.dimensions, request.copyDimensions),
    clearanceBelow: copyMeasure(f.clearanceBelow, request.copyDimensions),
  }));
  const surfaces = c.surfaces
    .filter((s) => map.has(s.furnitureId))
    .map((s) => ({
      ...s,
      id: uuid(),
      furnitureId: map.get(s.furnitureId)!,
      dimensions: copyDimensions(s.dimensions, request.copyDimensions),
      maxLoadKg: null,
    }));
  return {
    id,
    content: storeLayoutContentSchema.parse({
      ...c,
      assemblies: assembly
        ? [
            ...c.assemblies,
            {
              ...assembly,
              id,
              label: request.label,
              sourceKey: null,
              x: unknown(),
              y: unknown(),
              rotation: null,
              dimensions: copyDimensions(
                assembly.dimensions,
                request.copyDimensions,
              ),
            },
          ]
        : c.assemblies,
      furniture: [...c.furniture, ...furniture],
      surfaces: [...c.surfaces, ...surfaces],
    }),
  };
}

export function renameStoreLayoutInventory(
  input: Content,
  target: LayoutInventoryTarget,
  label: string,
): Content {
  const c = storeLayoutContentSchema.parse(input);
  const key =
    target.kind === "ASSEMBLY"
      ? "assemblies"
      : target.kind === "SURFACE"
        ? "surfaces"
        : "furniture";
  if (!c[key].some((v) => v.id === target.id))
    throw Error("Élément introuvable dans ce brouillon.");
  return storeLayoutContentSchema.parse({
    ...c,
    [key]: c[key].map((v) => (v.id === target.id ? { ...v, label } : v)),
  });
}

/** Draft-only removal retains dependent mobiles, detached, and every unrelated stable identity. */
export function removeStoreLayoutInventory(
  input: Content,
  target: LayoutInventoryTarget,
): Content {
  const c = storeLayoutContentSchema.parse(input);
  if (target.kind === "SURFACE") {
    const surface = c.surfaces.find((s) => s.id === target.id);
    if (
      !surface ||
      !c.furniture.some((f) => f.id === surface.furnitureId && f.kind === "TG")
    )
      throw Error(
        "Les surfaces obligatoires d’un élément ou d’un mobile ne peuvent pas être retirées isolément.",
      );
    return storeLayoutContentSchema.parse({
      ...c,
      surfaces: c.surfaces.filter((s) => s.id !== target.id),
    });
  }
  const assembly =
    target.kind === "ASSEMBLY"
      ? c.assemblies.find((a) => a.id === target.id)
      : null;
  if (
    !assembly &&
    !c.furniture.some((f) => target.kind === "FURNITURE" && f.id === target.id)
  )
    throw Error("Élément introuvable dans ce brouillon.");
  const removed = new Set(
    assembly
      ? c.furniture.filter((f) => f.assemblyId === assembly.id).map((f) => f.id)
      : [target.id],
  );
  return storeLayoutContentSchema.parse({
    ...c,
    assemblies: c.assemblies.filter((a) => !assembly || a.id !== assembly.id),
    furniture: c.furniture
      .filter((f) => !removed.has(f.id))
      .map((f) =>
        f.hostId && removed.has(f.hostId) ? { ...f, hostId: null } : f,
      ),
    surfaces: c.surfaces.filter((s) => !removed.has(s.furnitureId)),
  });
}
