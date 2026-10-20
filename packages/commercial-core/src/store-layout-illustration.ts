import {
  storeLayoutScenarioSchema,
  storeLayoutSchema,
  type StoreLayout,
  type StoreLayoutScenario,
} from "@fl-copilot/domain";
import { checkStoreLayoutGeometry } from "./store-layout-geometry";
import { layoutAllocationTargetLabel } from "./store-layout-scenario";

/** A derived source, never an adopted plan, stock estimate or declaration of execution. */
export function prepareStoreLayoutIllustration(
  storeId: string,
  rawScenario: StoreLayoutScenario,
  rawLayout: StoreLayout,
) {
  const scenario = storeLayoutScenarioSchema.parse(rawScenario),
    layout = storeLayoutSchema.parse(rawLayout);
  if (
    layout.storeId !== storeId ||
    scenario.storeId !== storeId ||
    layout.action !== "ADOPT_REFERENCE" ||
    layout.revisionId !== scenario.physicalRevisionId ||
    layout.version !== scenario.physicalVersion
  )
    throw Error("LAYOUT_ILLUSTRATION_SOURCE_INVALID");
  for (const a of scenario.assignments)
    if (
      layoutAllocationTargetLabel(
        layout.content,
        a.furnitureId,
        a.surfaceId,
      ) !== a.targetLabel
    )
      throw Error("LAYOUT_ILLUSTRATION_TARGET_INVALID");
  const geometry = checkStoreLayoutGeometry(layout.content);
  if (
    scenario.geometry.status !== geometry.status ||
    scenario.geometry.blocking !==
      geometry.issues.filter((i) => i.severity === "BLOCKING").length ||
    scenario.geometry.missing !==
      geometry.issues.filter((i) => i.severity === "MISSING").length
  )
    throw Error("LAYOUT_ILLUSTRATION_GEOMETRY_INVALID");
  const required: Array<{ targetId: string; fields: string[] }> = [];
  const roomFields = Object.entries(layout.content.room)
    .filter(([, v]) => v.mm === null)
    .map(([key]) => key);
  if (roomFields.length)
    required.push({ targetId: "room", fields: roomFields });
  for (const f of layout.content.furniture) {
    const fields = [
      ...(f.x.mm === null ? ["x"] : []),
      ...(f.y.mm === null ? ["y"] : []),
      ...(f.rotation === null ? ["rotation"] : []),
      ...(f.dimensions.width.mm === null ? ["width"] : []),
      ...(f.dimensions.depth.mm === null ? ["depth"] : []),
    ];
    if (fields.length) required.push({ targetId: f.id, fields });
  }
  return {
    schemaVersion: 1 as const,
    authority: "ILLUSTRATIVE_ONLY" as const,
    status:
      geometry.status === "BLOCKED"
        ? ("BLOCKED" as const)
        : required.length
          ? ("NEEDS_MEASUREMENTS" as const)
          : ("READY" as const),
    layout,
    scenario,
    geometry,
    required,
    // Room openings/passages/obstacles and loads are not persisted in v1 physical content.
    // A complete footprint drawing does not establish these constraints.
    limitations: [
      "Vue de dessus uniquement ; hauteurs et surfaces de vente ne sont pas déduites des emprises au sol.",
      "Entrées, obstacles, passages, charges et capacité de présentation restent à vérifier sur place.",
      "Les produits, surfaces et affectations restent ceux du scénario ; aucune quantité, stock ou mise en place n’est attesté.",
      ...(geometry.status !== "CHECKED"
        ? [
            "Le contrôle géométrique source reste incomplet ou présente des incompatibilités.",
          ]
        : []),
      ...([
        layout.content.room.width,
        layout.content.room.depth,
        ...layout.content.furniture.flatMap((f) => [
          f.x,
          f.y,
          f.dimensions.width,
          f.dimensions.depth,
        ]),
      ].some((m) => m.quality !== "MEASURED")
        ? [
            "Certaines positions ou dimensions connues sont déclarées ou issues d’une référence à confirmer, pas d’un relevé mesuré.",
          ]
        : []),
    ],
  };
}
export type StoreLayoutIllustrationSource = ReturnType<
  typeof prepareStoreLayoutIllustration
>;
