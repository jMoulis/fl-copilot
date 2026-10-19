import {
  storeLayoutContentSchema,
  type StoreLayoutContent,
} from "@fl-copilot/domain";

type Furniture = StoreLayoutContent["furniture"][number];
type Placement = Pick<Furniture, "x" | "y" | "rotation">;
const unknown = () => ({ mm: null, quality: "UNKNOWN" as const });
const dimensions = () => ({
  width: unknown(),
  depth: unknown(),
  height: unknown(),
});
const declared = (mm: number) => ({ mm, quality: "DECLARED" as const });
const hasPosition = (f: Placement) => f.x.mm !== null || f.y.mm !== null;

/** Absolute top-left coordinates, clockwise quarter turns. Never materializes drawing fallbacks. */
export function placeStoreLayoutObject(
  content: StoreLayoutContent,
  kind: "ASSEMBLY" | "FURNITURE",
  id: string,
  next: Placement,
): StoreLayoutContent {
  const c = storeLayoutContentSchema.parse(content);
  const object =
    kind === "ASSEMBLY"
      ? c.assemblies.find((a) => a.id === id)
      : c.furniture.find((f) => f.id === id);
  if (!object) throw Error("Élément introuvable dans ce brouillon.");
  const members =
    kind === "ASSEMBLY"
      ? new Set(c.furniture.filter((f) => f.assemblyId === id).map((f) => f.id))
      : new Set([id]);
  const related = c.furniture.filter(
    (f) =>
      (kind === "ASSEMBLY" && members.has(f.id)) ||
      (f.hostId !== null && members.has(f.hostId)),
  );
  const geometryChanged =
    object.x.mm !== next.x.mm ||
    object.y.mm !== next.y.mm ||
    object.rotation !== next.rotation;
  const located = related.filter(hasPosition);
  const rotationChanged = object.rotation !== next.rotation;
  let transformed = related;
  if (
    geometryChanged &&
    related.some((f) => hasPosition(f) || f.rotation !== null)
  ) {
    if (
      (located.length &&
        (object.x.mm === null ||
          object.y.mm === null ||
          next.x.mm === null ||
          next.y.mm === null)) ||
      (rotationChanged && (object.rotation === null || next.rotation === null))
    )
      throw Error(
        "Les positions déjà renseignées nécessitent un repère et une orientation connus avant ce déplacement.",
      );
    const ox = object.x.mm ?? 0,
      oy = object.y.mm ?? 0,
      nx = next.x.mm ?? 0,
      ny = next.y.mm ?? 0;
    const turn = rotationChanged
      ? (next.rotation! - object.rotation! + 360) % 360
      : 0;
    const w =
      (object.rotation ?? 0) % 180 === 0
        ? object.dimensions.width.mm
        : object.dimensions.depth.mm;
    const h =
      (object.rotation ?? 0) % 180 === 0
        ? object.dimensions.depth.mm
        : object.dimensions.width.mm;
    transformed = related.map((f) => {
      if (!hasPosition(f))
        return turn && f.rotation !== null
          ? {
              ...f,
              rotation: ((f.rotation + turn) % 360) as Furniture["rotation"],
            }
          : f;
      if (!turn)
        return {
          ...f,
          x: translated(f.x, nx - ox),
          y: translated(f.y, ny - oy),
        };
      if (
        f.x.mm === null ||
        f.y.mm === null ||
        f.rotation === null ||
        f.dimensions.width.mm === null ||
        f.dimensions.depth.mm === null ||
        w === null ||
        h === null
      )
        throw Error(
          `Complétez la position, l’orientation et l’emprise de ${f.label}, ainsi que l’emprise du repère, avant de tourner l’ensemble.`,
        );
      const x = f.x.mm - ox,
        y = f.y.mm - oy;
      const fw =
        f.rotation % 180 === 0 ? f.dimensions.width.mm : f.dimensions.depth.mm;
      const fh =
        f.rotation % 180 === 0 ? f.dimensions.depth.mm : f.dimensions.width.mm;
      const point =
        turn === 90
          ? [h - y - fh, x]
          : turn === 180
            ? [w - x - fw, h - y - fh]
            : [y, w - x - fw];
      return {
        ...f,
        x: declared(nx + point[0]!),
        y: declared(ny + point[1]!),
        rotation: ((f.rotation + turn) % 360) as Furniture["rotation"],
      };
    });
  }
  const byId = new Map(transformed.map((f) => [f.id, f]));
  const result = {
    ...c,
    assemblies: c.assemblies.map((a) =>
      kind === "ASSEMBLY" && a.id === id ? { ...a, ...next } : a,
    ),
    furniture: c.furniture.map((f) =>
      kind === "FURNITURE" && f.id === id
        ? { ...f, ...next }
        : (byId.get(f.id) ?? f),
    ),
  };
  if (result.furniture.some((f) => (f.x.mm ?? 0) < 0 || (f.y.mm ?? 0) < 0))
    throw Error(
      "Ce déplacement placerait un élément en dehors du repère positif du rayon.",
    );
  if (
    result.furniture.some(
      (f) => (f.x.mm ?? 0) > 100000 || (f.y.mm ?? 0) > 100000,
    )
  )
    throw Error(
      "Ce déplacement dépasserait la limite de 10 000 cm du repère d’un élément.",
    );
  return storeLayoutContentSchema.parse(result);
}
function translated(m: Furniture["x"], delta: number): Furniture["x"] {
  return delta === 0 || m.mm === null ? m : declared(m.mm + delta);
}

export function addStoreLayoutMobile(
  content: StoreLayoutContent,
  uuid: () => string,
  label: string,
  hostId: string | null,
) {
  const c = storeLayoutContentSchema.parse(content);
  if (
    hostId &&
    !c.furniture.some((f) => f.id === hostId && f.kind !== "MOBILE")
  )
    throw Error("Choisissez un élément fixe ou une TG présent dans le plan.");
  const id = uuid(),
    surfaceId = uuid();
  return storeLayoutContentSchema.parse({
    ...c,
    furniture: [
      ...c.furniture,
      {
        id,
        label,
        kind: "MOBILE",
        assemblyId: null,
        face: null,
        order: null,
        hostId,
        x: unknown(),
        y: unknown(),
        rotation: null,
        dimensions: dimensions(),
        clearanceBelow: unknown(),
        sourceKey: null,
      },
    ],
    surfaces: [
      ...c.surfaces,
      {
        id: surfaceId,
        furnitureId: id,
        kind: "MOBILE_DISPLAY",
        label: "Surface du mobile",
        dimensions: dimensions(),
        maxLoadKg: null,
      },
    ],
  });
}

/** Reassociation is an inventory decision, never evidence of position or fit. */
export function associateStoreLayoutMobile(
  content: StoreLayoutContent,
  id: string,
  hostId: string | null,
) {
  const c = storeLayoutContentSchema.parse(content),
    mobile = c.furniture.find((f) => f.id === id && f.kind === "MOBILE");
  if (!mobile) throw Error("Mobile introuvable dans ce brouillon.");
  if (
    hostId &&
    !c.furniture.some((f) => f.id === hostId && f.kind !== "MOBILE")
  )
    throw Error(
      "Le meuble associé doit être un élément fixe ou une TG présent dans ce brouillon.",
    );
  return storeLayoutContentSchema.parse({
    ...c,
    furniture: c.furniture.map((f) => (f.id === id ? { ...f, hostId } : f)),
  });
}

/** Only the current draft changes; immutable revisions retain the furniture and its selling surface. */
export function removeStoreLayoutMobile(
  content: StoreLayoutContent,
  id: string,
) {
  const c = storeLayoutContentSchema.parse(content);
  if (!c.furniture.some((f) => f.id === id && f.kind === "MOBILE"))
    throw Error("Seul un mobile peut être retiré avec cette action.");
  return storeLayoutContentSchema.parse({
    ...c,
    furniture: c.furniture.filter((f) => f.id !== id),
    surfaces: c.surfaces.filter((s) => s.furnitureId !== id),
  });
}
