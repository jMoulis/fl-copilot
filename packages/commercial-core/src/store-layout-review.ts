import type { StoreLayoutContent } from "@fl-copilot/domain";
type Furniture = StoreLayoutContent["furniture"][number];
type Measurement = Furniture["x"];
export function layoutMeasurementLabel(m: Measurement) {
  if (m.mm === null) return "À préciser";
  const cm = (m.mm / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `${cm} cm · ${m.quality === "REFERENCE" ? "à confirmer" : m.quality === "MEASURED" ? "relevé sur place" : "déclaré"}`;
}
export type LayoutChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};
export function layoutChanges(
  before: StoreLayoutContent | null,
  after: StoreLayoutContent,
): LayoutChange[] {
  const changes: LayoutChange[] = [];
  const add = (key: string, label: string, a: string, b: string) => {
    if (a !== b) changes.push({ key, label, before: a, after: b });
  };
  for (const key of ["width", "depth"] as const)
    add(
      `room:${key}`,
      key === "width" ? "Largeur du rayon" : "Profondeur du rayon",
      before ? layoutMeasurementLabel(before.room[key]) : "Non renseigné",
      layoutMeasurementLabel(after.room[key]),
    );
  for (const kind of ["assemblies", "furniture", "surfaces"] as const) {
    const old = new Map((before?.[kind] ?? []).map((x) => [x.id, x]));
    for (const item of after[kind]) {
      const prev = old.get(item.id);
      old.delete(item.id);
      if (!prev) {
        const placement =
          "x" in item
            ? ` · depuis la gauche ${layoutMeasurementLabel(item.x)}, depuis le haut ${layoutMeasurementLabel(item.y)} · orientation ${item.rotation === null ? "à préciser" : `${item.rotation}°`}`
            : "";
        const host =
          "hostId" in item && item.kind === "MOBILE"
            ? ` · ${item.hostId ? `habituellement sous ${after.furniture.find((f) => f.id === item.hostId)?.label ?? "élément à retrouver"}` : "sans meuble associé"}`
            : "";
        changes.push({
          key: item.id,
          label: item.label,
          before: "Absent de cette version",
          after: `Ajouté au plan · ${
            Object.entries(item.dimensions)
              .filter(([, m]) => m.mm !== null)
              .map(
                ([key, m]) =>
                  `${({ width: "largeur", depth: "profondeur", height: "hauteur" } as Record<string, string>)[key]} ${layoutMeasurementLabel(m)}`,
              )
              .join(" · ") || "mesures à préciser"
          }${placement}${host}`,
        });
        continue;
      }
      add(`${item.id}:label`, "Nom", prev.label, item.label);
      for (const d of ["width", "depth", "height"] as const)
        add(
          `${item.id}:${d}`,
          `${item.label} · ${{ width: "largeur", depth: "profondeur", height: "hauteur" }[d]}`,
          layoutMeasurementLabel(prev.dimensions[d]),
          layoutMeasurementLabel(item.dimensions[d]),
        );
      for (const key of ["x", "y", "clearanceBelow"] as const) {
        if (key in item && key in prev)
          add(
            `${item.id}:${key}`,
            `${item.label} · ${{ x: "position X", y: "position Y", clearanceBelow: "hauteur libre dessous" }[key]}`,
            layoutMeasurementLabel((prev as Furniture)[key]),
            layoutMeasurementLabel((item as Furniture)[key]),
          );
      }
      for (const key of [
        "rotation",
        "assemblyId",
        "face",
        "order",
        "hostId",
        "furnitureId",
        "kind",
        "maxLoadKg",
        "sourceKey",
      ]) {
        const a = prev as unknown as Record<string, unknown>,
          b = item as unknown as Record<string, unknown>;
        if (!(key in a) && !(key in b)) continue;
        const name: Record<string, string> = {
          rotation: "orientation",
          assemblyId: "îlot",
          face: "face",
          order: "position dans la face",
          hostId: "élément associé",
          furnitureId: "meuble",
          kind: "composition",
          maxLoadKg: "charge maximale",
          sourceKey: "provenance",
        };
        const value = (v: unknown) => {
          if (v === null || v === undefined) return "Non précisé";
          if (["assemblyId", "hostId", "furnitureId"].includes(key))
            return (
              [
                ...(before?.assemblies ?? []),
                ...(before?.furniture ?? []),
                ...after.assemblies,
                ...after.furniture,
              ].find((x) => x.id === v)?.label ?? "Élément d’une autre version"
            );
          const terms: Record<string, string> = {
            FIXED: "Élément d’îlot",
            TG: "TG",
            MOBILE: "Mobile",
            BAC: "Bac",
            UPPER_SHELF: "Étagère supérieure",
            MOBILE_DISPLAY: "Surface mobile",
            OTHER: "Autre surface",
          };
          return (
            terms[String(v)] ??
            `${v}${key === "rotation" ? "°" : key === "maxLoadKg" ? " kg" : ""}`
          );
        };
        add(
          `${item.id}:${key}`,
          `${item.label} · ${name[key]}`,
          value(a[key]),
          value(b[key]),
        );
      }
    }
    for (const item of old.values())
      changes.push({
        key: item.id,
        label: item.label,
        before: "Présent dans cette version",
        after: "Retiré du plan",
      });
  }
  add(
    "provenance",
    "Origine",
    before?.provenance.reference ?? "Saisie magasin",
    after.provenance.reference ?? "Saisie magasin",
  );
  return changes;
}
