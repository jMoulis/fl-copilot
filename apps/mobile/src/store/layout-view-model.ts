export {
  layoutMeasurementLabel,
  layoutChanges,
  type LayoutChange,
} from "@fl-copilot/commercial-core";
import {
  storeLayoutContentSchema,
  type StoreLayout,
  type StoreLayoutContent,
} from "@fl-copilot/domain";
type Furniture = StoreLayoutContent["furniture"][number];
type Measurement = Furniture["x"];
export type LayoutRect = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  schematic: boolean;
  kind: "ASSEMBLY" | Furniture["kind"];
};
export type LayoutViewport = { scale: number; x: number; y: number };
export const initialLayoutViewport: LayoutViewport = { scale: 1, x: 0, y: 0 };
export function layoutViewport(v: LayoutViewport): LayoutViewport {
  const scale = Math.min(
      4,
      Math.max(1, Number.isFinite(v.scale) ? v.scale : 1),
    ),
    bound = (scale - 1) / 2;
  return {
    scale,
    x: Math.max(-bound, Math.min(bound, Number.isFinite(v.x) ? v.x : 0)),
    y: Math.max(-bound, Math.min(bound, Number.isFinite(v.y) ? v.y : 0)),
  };
}
/** Drawing-only slot fallback. Never writes derived coordinates or dimensions into the reference. */
export function layoutDrawing(c: StoreLayoutContent) {
  const groups: LayoutRect[] = c.assemblies.map((a, i) => ({
    id: a.id,
    label: a.label,
    x: a.x.mm ?? 1000 + i * 3500,
    y: a.y.mm ?? 1500,
    width:
      (a.rotation === 90 || a.rotation === 270
        ? a.dimensions.depth.mm
        : a.dimensions.width.mm) ?? 1800,
    height:
      (a.rotation === 90 || a.rotation === 270
        ? a.dimensions.width.mm
        : a.dimensions.depth.mm) ?? 4200,
    schematic:
      a.rotation === null ||
      a.x.mm === null ||
      a.y.mm === null ||
      a.dimensions.width.mm === null ||
      a.dimensions.depth.mm === null,
    kind: "ASSEMBLY",
  }));
  const fixtures: LayoutRect[] = [];
  for (const [i, f] of c.furniture.entries()) {
    const rotated = f.rotation === 90 || f.rotation === 270;
    if (
      f.x.mm !== null &&
      f.y.mm !== null &&
      f.dimensions.width.mm !== null &&
      f.dimensions.depth.mm !== null &&
      f.rotation !== null
    ) {
      fixtures.push({
        id: f.id,
        label: f.label,
        x: f.x.mm,
        y: f.y.mm,
        width: rotated ? f.dimensions.depth.mm : f.dimensions.width.mm,
        height: rotated ? f.dimensions.width.mm : f.dimensions.depth.mm,
        schematic: false,
        kind: f.kind,
      });
      continue;
    }
    const group = groups.find((g) => g.id === f.assemblyId),
      assembly = c.assemblies.find((a) => a.id === f.assemblyId);
    if (group && assembly && f.kind === "FIXED") {
      const count = Math.max(
        1,
        ...c.furniture
          .filter((o) => o.assemblyId === f.assemblyId && o.face === f.face)
          .map((o) => o.order ?? 1),
      );
      const rotation = assembly.rotation ?? 0,
        w = rotation === 90 || rotation === 270 ? group.height : group.width,
        d = rotation === 90 || rotation === 270 ? group.width : group.height;
      const bw = w / 2,
        bh = d / count,
        u = f.face === "A" ? 0 : bw,
        v = ((f.order ?? 1) - 1) * bh;
      const rect =
        rotation === 90
          ? { x: d - v - bh, y: u, width: bh, height: bw }
          : rotation === 180
            ? { x: w - u - bw, y: d - v - bh, width: bw, height: bh }
            : rotation === 270
              ? { x: v, y: w - u - bw, width: bh, height: bw }
              : { x: u, y: v, width: bw, height: bh };
      fixtures.push({
        id: f.id,
        label: f.label,
        x: group.x + rect.x,
        y: group.y + rect.y,
        width: rect.width,
        height: rect.height,
        schematic: true,
        kind: f.kind,
      });
    } else if (f.kind !== "MOBILE" || !f.hostId) {
      fixtures.push({
        id: f.id,
        label: f.label,
        x: f.x.mm ?? 1000 + (i % 4) * 2300,
        y: f.y.mm ?? 6500 + Math.floor(i / 4) * 1000,
        width: f.dimensions.width.mm ?? 1700,
        height: f.dimensions.depth.mm ?? 800,
        schematic: true,
        kind: f.kind,
      });
    }
  }
  const rectangles = [...groups, ...fixtures],
    width = Math.max(
      c.room.width.mm ?? 0,
      1000,
      ...rectangles.map((r) => r.x + r.width + 500),
    ),
    height = Math.max(
      c.room.depth.mm ?? 0,
      1000,
      ...rectangles.map((r) => r.y + r.height + 500),
    );
  return {
    width,
    height,
    groups,
    fixtures,
    schematic: rectangles.some((r) => r.schematic),
    roomKnown: c.room.width.mm !== null && c.room.depth.mm !== null,
  };
}
export function layoutNumber(m: Measurement) {
  return m.mm === null ? "" : String(m.mm / 10).replace(".", ",");
}
export function parseLayoutMeasure(
  text: string,
  previous: Measurement,
  measured: boolean,
  allowZero = false,
): Measurement {
  if (!text.trim()) return { mm: null, quality: "UNKNOWN" };
  const normalized = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d)?$/.test(normalized))
    throw Error("Indiquez des centimètres, avec une décimale au maximum.");
  const mm = Math.round(Number(normalized) * 10);
  if (mm < 0 || (!allowZero && mm === 0) || mm > 100000)
    throw Error(
      allowZero
        ? "Indiquez une valeur entre 0 et 10 000 cm."
        : "La mesure doit être supérieure à zéro et ne pas dépasser 10 000 cm.",
    );
  if (mm === previous.mm && !measured) return previous;
  return { mm, quality: measured ? "MEASURED" : "DECLARED" };
}
export type LayoutEdit = {
  baseRevisionId: string;
  content: StoreLayoutContent;
  undo: StoreLayoutContent[];
};
export function patchLayoutEdit(
  edit: LayoutEdit,
  content: StoreLayoutContent,
): LayoutEdit {
  const parsed = storeLayoutContentSchema.parse(content);
  if (JSON.stringify(parsed) === JSON.stringify(edit.content)) return edit;
  return {
    ...edit,
    content: parsed,
    undo: [...edit.undo.slice(-19), edit.content],
  };
}
export function undoLayoutEdit(edit: LayoutEdit): LayoutEdit {
  const prior = edit.undo.at(-1);
  return prior
    ? { ...edit, content: prior, undo: edit.undo.slice(0, -1) }
    : edit;
}
export function visibleLayout(
  head: StoreLayout | null,
  reference: StoreLayout | null,
) {
  return head &&
    (head.action === "SAVE_DRAFT" ||
      head.action === "RESTORE_AS_DRAFT" ||
      head.action === "ADOPT_REFERENCE")
    ? head
    : reference;
}
export function layoutError(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code.includes("GEOMETRY_BLOCKED"))
    return "Ce plan présente une incompatibilité géométrique. Votre brouillon reste conservé ; ouvrez les éléments signalés avant de choisir la référence.";
  if (code.includes("SOURCE_CHANGED"))
    return "La comparaison du plan a changé depuis votre ouverture. Votre saisie est conservée ; comparez les versions avant de reprendre.";
  if (code.includes("RESOLVE") || code.includes("RESOLUTION"))
    return "Ce plan nécessite une comparaison. Votre version reste conservée sur cet appareil.";
  if (code.includes("AUTHORITY_CHANGED"))
    return "Le compte, le magasin ou les droits ont changé. Rouvrez le plan avant de reprendre ; vos versions sont conservées.";
  if (code.includes("SYNCING"))
    return "Un envoi du plan est en cours. Attendez sa fin avant de choisir une version.";
  return "L’enregistrement n’a pas abouti. Votre saisie reste visible ; réessayez sans quitter la page.";
}
