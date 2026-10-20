import {
  copilotLayoutEditInputSchema,
  layoutCreatedIdsSchema,
  layoutInventoryCreatedIdsSchema,
  validateStoreLayoutReadSnapshot,
  storeLayoutContentSchema,
  type StoreLayoutContent,
  type CopilotLayoutEditInput,
  type CopilotLayoutCreatedIds,
} from "@fl-copilot/domain";
import {
  addStoreLayoutInventory,
  addStoreLayoutTgSurface,
  duplicateStoreLayoutInventory,
  removeStoreLayoutInventory,
} from "./store-layout-inventory";
import {
  placeStoreLayoutObject,
  addStoreLayoutMobile,
  associateStoreLayoutMobile,
  removeStoreLayoutMobile,
} from "./store-layout-editing";
import { checkStoreLayoutGeometry } from "./store-layout-geometry";
import { layoutChanges } from "./store-layout-review";
/** Same qualified patch and child transforms on remote preview and local confirmation. No persistence or authority. */
export function prepareStoreLayoutEdit(
  storeId: string,
  raw: unknown,
  snapshot: unknown,
  rawCreated: unknown = null,
  uuid?: () => string,
) {
  const input = copilotLayoutEditInputSchema.parse(raw),
    { head, reference } = validateStoreLayoutReadSnapshot(storeId, snapshot);
  const empty = {
    input,
    basis: null,
    created: null,
    changes: [],
    geometry: null,
    before: null,
    after: null,
  };
  if (!head)
    return {
      ...empty,
      status: "ABSENT" as const,
      message:
        "Aucun plan synchronisé disponible. Créez ou synchronisez le plan du magasin avant de le modifier.",
    };
  if (head.revisionId !== input.expectedRevisionId)
    return {
      ...empty,
      status: "STALE" as const,
      message:
        "Le plan a changé. Consultez sa version actuelle avant de préparer une nouvelle modification.",
    };
  const source = head.action === "DISCARD_DRAFT" ? reference : head;
  if (!source)
    return {
      ...empty,
      status: "BLOCKED" as const,
      message:
        "Le brouillon a été abandonné et aucune référence adoptée n’est disponible. Ouvrez le plan du magasin pour reprendre.",
    };
  const basis = {
    storeId,
    revisionId: head.revisionId,
    version: head.version,
    sourceRevisionId: source.revisionId,
  };
  try {
    const before = source.content;
    let after = storeLayoutContentSchema.parse(before),
      created: CopilotLayoutCreatedIds | null = null;
    const inventoryCreation =
      input.action !== "ADD_MOBILE" &&
      (input.action.startsWith("ADD_") || input.action.startsWith("COPY_"));
    const ids =
      inventoryCreation && rawCreated !== null
        ? layoutInventoryCreatedIdsSchema.parse(rawCreated).ids
        : [];
    let at = 0;
    const nextId = () => {
      if (at >= 257)
        throw Error("La copie dépasse les limites d’inventaire du plan.");
      if (rawCreated === null) {
        if (!uuid)
          throw Error(
            "Les identités de cette proposition sont absentes. Demandez une nouvelle proposition.",
          );
        ids.push(uuid());
      }
      const id = ids[at++];
      if (!id)
        throw Error("Les identités de cette proposition sont incomplètes.");
      return id;
    };
    if (
      !inventoryCreation &&
      input.action !== "ADD_MOBILE" &&
      rawCreated !== null
    )
      throw Error("Cette modification ne crée aucune identité.");
    if (input.action === "EDIT") {
      after = applyRequestedFields(after, input.targetId, input.patch);
    } else if (input.action === "ADD_MOBILE") {
      created = layoutCreatedIdsSchema.parse(rawCreated);
      const ids = [created.furnitureId, created.surfaceId];
      let at = 0;
      after = addStoreLayoutMobile(
        after,
        () => ids[at++]!,
        input.label,
        input.hostId,
      );
      if (input.patch)
        after = applyRequestedFields(after, created.furnitureId, input.patch);
    } else if (input.action === "ASSOCIATE_MOBILE")
      after = associateStoreLayoutMobile(after, input.targetId, input.hostId);
    else if (input.action === "REMOVE_MOBILE")
      after = removeStoreLayoutMobile(after, input.targetId);
    else if (input.action === "ADD_ASSEMBLY" || input.action === "ADD_TG")
      after = addStoreLayoutInventory(
        after,
        {
          kind: input.action === "ADD_ASSEMBLY" ? "ASSEMBLY" : "TG",
          label: input.label,
        },
        nextId,
      ).content;
    else if (input.action === "ADD_FIXED")
      after = addStoreLayoutInventory(
        after,
        {
          kind: "FIXED",
          label: input.label,
          assemblyId: input.assemblyId,
          face: input.face,
          order: input.order,
        },
        nextId,
      ).content;
    else if (input.action === "ADD_TG_SURFACE")
      after = addStoreLayoutTgSurface(
        after,
        input.furnitureId,
        input.label,
        input.surfaceKind,
        nextId,
      ).content;
    else if (
      input.action === "COPY_ASSEMBLY" ||
      input.action === "COPY_FURNITURE"
    ) {
      const furniture =
        input.action === "COPY_FURNITURE"
          ? after.furniture.find((f) => f.id === input.targetId)
          : null;
      if (
        input.action === "COPY_FURNITURE" &&
        !!input.slot !== (furniture?.kind === "FIXED")
      )
        throw Error(
          "Un élément fixe exige un rang libre ; une TG ou un mobile ne rejoint pas une face d’îlot.",
        );
      after = duplicateStoreLayoutInventory(
        after,
        {
          kind: input.action === "COPY_ASSEMBLY" ? "ASSEMBLY" : "FURNITURE",
          id: input.targetId,
        },
        {
          label: input.label,
          copyDimensions: input.copyDimensions,
          ...(input.action === "COPY_FURNITURE" && input.slot
            ? { slot: input.slot }
            : {}),
        },
        nextId,
      ).content;
    } else
      after = removeStoreLayoutInventory(after, {
        kind:
          input.action === "REMOVE_ASSEMBLY"
            ? "ASSEMBLY"
            : input.action === "REMOVE_TG_SURFACE"
              ? "SURFACE"
              : "FURNITURE",
        id: input.targetId,
      });
    if (inventoryCreation) {
      if (at !== ids.length)
        throw Error(
          "Les identités de cette proposition ne correspondent pas à son inventaire.",
        );
      created = layoutInventoryCreatedIdsSchema.parse({ ids });
    }
    const report = checkStoreLayoutGeometry(after),
      changes = layoutChanges(before, after);
    return {
      input,
      basis,
      created,
      status: changes.length ? ("READY" as const) : ("UNCHANGED" as const),
      changes,
      before,
      after,
      geometry: {
        status: report.status,
        blocking: report.issues.filter((x) => x.severity === "BLOCKING").length,
        missing: report.issues.filter((x) => x.severity === "MISSING").length,
      },
      message: changes.length
        ? "Modification préparée pour le brouillon, à confirmer sur cet appareil. La référence adoptée reste conservée ; les mesures saisies deviennent déclarées, pas relevées sur place. Les incompatibilités éventuelles empêchent l’adoption, pas la sauvegarde du brouillon."
        : "Ces valeurs sont déjà enregistrées avec cette qualification ; aucun changement supplémentaire.",
    };
  } catch (error) {
    const message =
      error instanceof Error && !error.message.startsWith("[")
        ? error.message
        : "Vérifiez les mesures : dimensions positives, centimètres avec une décimale, cibles et limites du plan.";
    return { ...empty, basis, status: "BLOCKED" as const, message };
  }
}

function applyRequestedFields(
  after: StoreLayoutContent,
  targetId: string | null,
  p: Extract<CopilotLayoutEditInput, { action: "EDIT" }>["patch"],
) {
  const kind =
    targetId === null
      ? "ROOM"
      : after.assemblies.some((x) => x.id === targetId)
        ? "ASSEMBLY"
        : after.furniture.some((x) => x.id === targetId)
          ? "FURNITURE"
          : after.surfaces.some((x) => x.id === targetId)
            ? "SURFACE"
            : null;
  if (!kind)
    throw Error(
      "Cet élément n’existe pas dans la version actuelle du plan. Choisissez la cible exacte.",
    );
  const allowed =
    kind === "ROOM"
      ? ["widthCm", "depthCm"]
      : kind === "SURFACE"
        ? ["label", "widthCm", "depthCm", "heightCm", "maxLoadKg"]
        : kind === "ASSEMBLY"
          ? [
              "label",
              "widthCm",
              "depthCm",
              "heightCm",
              "xCm",
              "yCm",
              "rotation",
            ]
          : [
              "label",
              "widthCm",
              "depthCm",
              "heightCm",
              "xCm",
              "yCm",
              "rotation",
              "clearanceBelowCm",
            ];
  if (Object.keys(p).some((k) => !allowed.includes(k)))
    throw Error(
      "Cette modification ne correspond pas aux champs de l’élément choisi. Vérifiez la cible.",
    );
  const measure = (
    value: number | null,
    previous: StoreLayoutContent["room"]["width"],
  ) => {
    const mm = value === null ? null : Math.round(value * 10);
    if (mm === previous.mm && previous.quality !== "REFERENCE") return previous;
    return {
      mm,
      quality: mm === null ? ("UNKNOWN" as const) : ("DECLARED" as const),
    };
  };
  const dims = (d: StoreLayoutContent["room"]) => ({
    ...d,
    ...(p.widthCm !== undefined ? { width: measure(p.widthCm, d.width) } : {}),
    ...(p.depthCm !== undefined ? { depth: measure(p.depthCm, d.depth) } : {}),
  });
  if (kind === "ROOM") after.room = dims(after.room);
  else {
    const collection =
      kind === "ASSEMBLY"
        ? "assemblies"
        : kind === "FURNITURE"
          ? "furniture"
          : "surfaces";
    // Dimensions must be changed before a requested rotation uses the object's new local footprint.
    after = storeLayoutContentSchema.parse({
      ...after,
      [collection]: after[collection].map((x) =>
        x.id !== targetId
          ? x
          : {
              ...x,
              ...(p.label !== undefined ? { label: p.label } : {}),
              dimensions: {
                ...dims(x.dimensions),
                height:
                  p.heightCm !== undefined
                    ? measure(p.heightCm, x.dimensions.height)
                    : x.dimensions.height,
              },
              ...(p.clearanceBelowCm !== undefined
                ? {
                    clearanceBelow: measure(
                      p.clearanceBelowCm,
                      "clearanceBelow" in x
                        ? x.clearanceBelow
                        : { mm: null, quality: "UNKNOWN" },
                    ),
                  }
                : {}),
              ...(p.maxLoadKg !== undefined ? { maxLoadKg: p.maxLoadKg } : {}),
            },
      ),
    });
    if (
      kind !== "SURFACE" &&
      (p.xCm !== undefined || p.yCm !== undefined || p.rotation !== undefined)
    ) {
      const object =
        kind === "ASSEMBLY"
          ? after.assemblies.find((x) => x.id === targetId)!
          : after.furniture.find((x) => x.id === targetId)!;
      after = placeStoreLayoutObject(after, kind, targetId!, {
        x: p.xCm !== undefined ? measure(p.xCm, object.x) : object.x,
        y: p.yCm !== undefined ? measure(p.yCm, object.y) : object.y,
        rotation: p.rotation !== undefined ? p.rotation : object.rotation,
      });
    }
  }

  return after;
}
