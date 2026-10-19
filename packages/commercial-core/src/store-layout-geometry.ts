import {
  storeLayoutContentSchema,
  storeLayoutGeometrySchema,
  type StoreLayoutContent,
  type StoreLayoutGeometry,
  type StoreLayoutGeometryIssue,
} from "@fl-copilot/domain";
type Furniture = StoreLayoutContent["furniture"][number];
type LayoutObject = Furniture | StoreLayoutContent["assemblies"][number];
type Box = StoreLayoutGeometry["footprints"][number];
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.depth &&
  a.y + a.depth > b.y;
const contains = (a: Box, b: Box) =>
  b.x >= a.x &&
  b.y >= a.y &&
  b.x + b.width <= a.x + a.width &&
  b.y + b.depth <= a.y + a.depth;

/** Conservative axis extent: lower bounds prove impossibility; upper bounds avoid inventing a missing orientation. */
function extent(
  o: LayoutObject,
  axis: "width" | "depth",
  bound: "MIN" | "MAX" = "MIN",
) {
  if (o.rotation !== null)
    return o.dimensions[
      o.rotation % 180 === 0 ? axis : axis === "width" ? "depth" : "width"
    ].mm;
  const w = o.dimensions.width.mm,
    d = o.dimensions.depth.mm;
  return w === null || d === null
    ? null
    : bound === "MIN"
      ? Math.min(w, d)
      : Math.max(w, d);
}
function footprint(o: LayoutObject): Box | null {
  if (
    o.rotation === null ||
    o.x.mm === null ||
    o.y.mm === null ||
    o.dimensions.width.mm === null ||
    o.dimensions.depth.mm === null
  )
    return null;
  return {
    id: o.id,
    kind: "kind" in o ? o.kind : "ASSEMBLY",
    x: o.x.mm,
    y: o.y.mm,
    width: extent(o, "width")!,
    depth: extent(o, "depth")!,
  };
}

/** Full canonical inventory, no drawing fallbacks, arbitrary eight-fixture batches or business writes. */
export function checkStoreLayoutGeometry(
  raw: StoreLayoutContent,
): StoreLayoutGeometry {
  const c = storeLayoutContentSchema.parse(raw),
    issues: StoreLayoutGeometryIssue[] = [];
  const issue = (
    code: StoreLayoutGeometryIssue["code"],
    severity: StoreLayoutGeometryIssue["severity"],
    targets: string[],
    message: string,
  ) => issues.push({ code, severity, targets, message });
  const roomMissing = Object.entries(c.room)
    .filter(([, m]) => m.mm === null)
    .map(([k]) => (k === "width" ? "largeur" : "profondeur"));
  if (roomMissing.length)
    issue(
      "MISSING_GEOMETRY",
      "MISSING",
      ["room"],
      `Rayon : ${roomMissing.join(" et ")} à préciser.`,
    );
  if (Object.values(c.room).some((m) => m.quality === "REFERENCE"))
    issue(
      "REFERENCE_UNCONFIRMED",
      "MISSING",
      ["room"],
      "Rayon : les dimensions de référence restent à confirmer.",
    );
  if (!c.furniture.length)
    issue(
      "INVENTORY_EMPTY",
      "MISSING",
      ["room"],
      "Aucun mobilier enregistré ; le contrôle ne confirme pas l’inventaire du rayon.",
    );
  const objects: LayoutObject[] = [...c.assemblies, ...c.furniture],
    boxes = new Map<string, Box>();
  for (const o of objects) {
    const missing = [
      o.x.mm === null ? "position depuis la gauche" : null,
      o.y.mm === null ? "position depuis le haut" : null,
      o.rotation === null ? "orientation" : null,
      o.dimensions.width.mm === null ? "largeur" : null,
      o.dimensions.depth.mm === null ? "profondeur" : null,
    ].filter(Boolean);
    if (missing.length)
      issue(
        "MISSING_GEOMETRY",
        "MISSING",
        [o.id],
        `${o.label} : ${missing.join(", ")} à préciser.`,
      );
    if (
      [o.x, o.y, o.dimensions.width, o.dimensions.depth].some(
        (m) => m.quality === "REFERENCE",
      )
    )
      issue(
        "REFERENCE_UNCONFIRMED",
        "MISSING",
        [o.id],
        `${o.label} : emprise calculée à partir de mesures de référence à confirmer.`,
      );
    const box = footprint(o);
    if (box) boxes.set(o.id, box);
    const outside = (
      origin: number | null,
      size: number | null,
      limit: number | null,
    ) =>
      limit !== null &&
      ((origin !== null && origin >= limit) ||
        (size !== null && (origin ?? 0) + size > limit));
    if (
      outside(o.x.mm, extent(o, "width"), c.room.width.mm) ||
      outside(o.y.mm, extent(o, "depth"), c.room.depth.mm)
    )
      issue(
        "OUT_OF_BOUNDS",
        "BLOCKING",
        [o.id, "room"],
        `${o.label} dépasse les limites renseignées du rayon.`,
      );
  }
  for (const a of c.assemblies) {
    const members = c.furniture.filter((f) => f.assemblyId === a.id),
      parent = boxes.get(a.id);
    if (!members.length)
      issue(
        "INVENTORY_EMPTY",
        "MISSING",
        [a.id],
        `${a.label} : aucun élément rattaché à cet îlot.`,
      );
    for (const f of members) {
      const child = boxes.get(f.id);
      const tooLarge = (["width", "depth"] as const).some((axis) => {
        const min = extent(f, axis),
          max = extent(a, axis, "MAX");
        return min !== null && max !== null && min > max;
      });
      const outsideKnownEdge = (["x", "y"] as const).some((axis) => {
        const origin = f[axis].mm,
          start = a[axis].mm,
          dimension = axis === "x" ? "width" : "depth";
        if (origin === null || start === null) return false;
        const available = extent(a, dimension, "MAX"),
          size = extent(f, dimension);
        return (
          origin < start ||
          (available !== null &&
            (origin >= start + available ||
              (size !== null && origin + size > start + available)))
        );
      });
      if (
        tooLarge ||
        outsideKnownEdge ||
        (parent && child && !contains(parent, child))
      )
        issue(
          "OUTSIDE_ASSEMBLY",
          "BLOCKING",
          [f.id, a.id],
          `${f.label} ne tient pas dans l’enveloppe renseignée de ${a.label}.`,
        );
    }
  }
  const furniture = c.furniture.filter((f) => boxes.has(f.id));
  for (const f of c.furniture)
    if (
      f.kind !== "MOBILE" &&
      f.dimensions.height.mm !== null &&
      f.clearanceBelow.mm !== null &&
      f.clearanceBelow.mm > f.dimensions.height.mm
    )
      issue(
        "CLEARANCE_INCONSISTENT",
        "BLOCKING",
        [f.id],
        `${f.label} : la hauteur libre sous le meuble dépasse sa hauteur totale renseignée.`,
      );
  for (let i = 0; i < furniture.length; i++)
    for (let j = i + 1; j < furniture.length; j++) {
      const a = furniture[i]!,
        b = furniture[j]!;
      if (!overlap(boxes.get(a.id)!, boxes.get(b.id)!)) continue;
      const mobile =
        a.kind === "MOBILE" && b.kind !== "MOBILE"
          ? a
          : b.kind === "MOBILE" && a.kind !== "MOBILE"
            ? b
            : null;
      if (!mobile) {
        issue(
          "COLLISION",
          "BLOCKING",
          [a.id, b.id],
          `${a.label} et ${b.label} se chevauchent au sol.`,
        );
        continue;
      }
      const fixed = mobile.id === a.id ? b : a,
        height = mobile.dimensions.height,
        clearance = fixed.clearanceBelow;
      if (
        height.mm !== null &&
        fixed.dimensions.height.mm !== null &&
        height.mm > fixed.dimensions.height.mm
      )
        issue(
          "CLEARANCE_EXCEEDED",
          "BLOCKING",
          [mobile.id, fixed.id],
          `${mobile.label} dépasse même la hauteur totale renseignée de ${fixed.label} et ne peut pas passer dessous.`,
        );
      else if (height.mm === null || clearance.mm === null)
        issue(
          "VERTICAL_FIT_UNKNOWN",
          "MISSING",
          [mobile.id, fixed.id],
          `${mobile.label} se superpose à ${fixed.label} : précisez la hauteur du mobile et la hauteur libre sous le meuble avant de conclure.`,
        );
      else if (height.mm > clearance.mm)
        issue(
          "CLEARANCE_EXCEEDED",
          "BLOCKING",
          [mobile.id, fixed.id],
          `${mobile.label} est trop haut pour la hauteur libre renseignée sous ${fixed.label}.`,
        );
      else if (
        height.quality === "REFERENCE" ||
        clearance.quality === "REFERENCE"
      )
        issue(
          "REFERENCE_UNCONFIRMED",
          "MISSING",
          [mobile.id, fixed.id],
          `La superposition de ${mobile.label} sous ${fixed.label} utilise des hauteurs de référence à confirmer.`,
        );
    }
  for (const m of c.furniture.filter((f) => f.kind === "MOBILE" && f.hostId)) {
    const box = boxes.get(m.id),
      host = boxes.get(m.hostId!);
    if (!box || !host)
      issue(
        "HOST_POSITION_UNCONFIRMED",
        "MISSING",
        [m.id, m.hostId!],
        `${m.label} : l’association à son meuble habituel ne confirme pas sa position ni son passage dessous.`,
      );
    else if (!contains(host, box))
      issue(
        "HOST_POSITION_UNCONFIRMED",
        "NOTICE",
        [m.id, m.hostId!],
        `${m.label} n’est pas entièrement sous l’emprise de son meuble habituel. L’association seule ne permet pas de conclure qu’il est rangé dessous.`,
      );
  }
  // Group outlines are context, never extra physical furniture. With missing members, overlapping envelopes signal uncertainty only.
  const incomplete = c.assemblies.filter((a) =>
    c.furniture.some((f) => f.assemblyId === a.id && !boxes.has(f.id)),
  );
  const incompleteIds = new Set(incomplete.map((a) => a.id));
  for (let i = 0; i < c.assemblies.length; i++)
    for (let j = i + 1; j < c.assemblies.length; j++) {
      const a = c.assemblies[i]!,
        b = c.assemblies[j]!,
        aa = boxes.get(a.id),
        bb = boxes.get(b.id);
      if (
        aa &&
        bb &&
        (incompleteIds.has(a.id) || incompleteIds.has(b.id)) &&
        overlap(aa, bb)
      )
        issue(
          "ENVELOPE_OVERLAP",
          "MISSING",
          [a.id, b.id],
          `Les enveloppes de ${a.label} et ${b.label} se superposent ; les positions manquantes de leurs éléments empêchent de conclure à une collision physique.`,
        );
    }
  for (const a of incomplete)
    for (const f of furniture) {
      if (
        f.assemblyId ||
        (f.hostId &&
          c.furniture.some((h) => h.id === f.hostId && h.assemblyId === a.id))
      )
        continue;
      const box = boxes.get(a.id);
      if (box && overlap(box, boxes.get(f.id)!))
        issue(
          "ENVELOPE_OVERLAP",
          "MISSING",
          [a.id, f.id],
          `${f.label} croise l’enveloppe de ${a.label} ; complétez les positions des éléments pour vérifier cette zone.`,
        );
    }
  return storeLayoutGeometrySchema.parse({
    schemaVersion: 1,
    authority: "PROVISIONAL",
    scope: "FOOTPRINTS_AND_CLEARANCE",
    status: issues.some((i) => i.severity === "BLOCKING")
      ? "BLOCKED"
      : issues.some((i) => i.severity === "MISSING")
        ? "INCOMPLETE"
        : "CHECKED",
    counts: {
      assemblies: c.assemblies.length,
      fixed: c.furniture.filter((f) => f.kind === "FIXED").length,
      tg: c.furniture.filter((f) => f.kind === "TG").length,
      mobiles: c.furniture.filter((f) => f.kind === "MOBILE").length,
      furniture: c.furniture.length,
      located: furniture.length,
    },
    footprints: [...boxes.values()],
    issues,
  });
}

export function assertStoreLayoutAdoptable(content: StoreLayoutContent) {
  if (checkStoreLayoutGeometry(content).status === "BLOCKED")
    throw Error("STORE_LAYOUT_GEOMETRY_BLOCKED");
}
