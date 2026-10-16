import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotPreparationPatchSchema,
  copilotPreparationPreviewSchema,
  prepareWeekPatch,
  preparationRequestSchema,
} from "@fl-copilot/domain";
import { loadCommercialPreparationContext } from "./commercial-preparation-tool.js";
/** Reuses complete canonical reference checks; only prepares an existing draft. */
export async function readPreparationPreview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotPreparationPatchSchema.parse(raw);
  // At most 100 references, no unbounded source/product scan. All issue checks cover all references.
  const r = await loadCommercialPreparationContext(db, storeId, {
    weekStart: input.weekStart,
    offset: 0,
    limit: 10,
  });
  const all = r.all;
  let status: "READY" | "UNCHANGED" | "UNAVAILABLE" | "BLOCKED" = "READY";
  const basis =
    r.preparation && all.length === r.preparation.offerRefs.length
      ? { preparation: r.preparation, choices: all }
      : null;
  if (!basis) status = "UNAVAILABLE";
  else if (r.issues.length) status = "BLOCKED";
  else
    try {
      const request = prepareWeekPatch(
        input,
        basis,
        "00000000-0000-4000-8000-000000000001",
      );
      const current = preparationRequestSchema.shape.input.shape.draft
        .strip()
        .parse(basis.preparation);
      if (JSON.stringify(current) === JSON.stringify(request.input.draft))
        status = "UNCHANGED";
    } catch {
      status = "BLOCKED";
    }
  const hash = createHash("sha256")
    .update(JSON.stringify([storeId, input, basis, status]))
    .digest("hex");
  return copilotPreparationPreviewSchema.parse({
    input,
    status,
    basis,
    evidence: [
      {
        id: `preparation-preview/${hash}`,
        sourceId: r.preparation?.id ?? storeId,
        sourceType: "DATA_QUALITY",
        sourceVersion: r.preparation?.version ?? null,
        label: "Modification du brouillon TG",
        factKind: "QUALITY",
        value:
          status === "READY"
            ? "Modification préparée, à confirmer sur l’appareil. Le brouillon sera enregistré localement ; aucune validation de plan ni installation en rayon."
            : status === "UNCHANGED"
              ? "Le brouillon contient déjà ces valeurs ; aucun changement."
              : status === "UNAVAILABLE"
                ? "Le brouillon ou ses offres ne sont pas disponibles. Ouvrez ou créez la préparation hebdomadaire, puis synchronisez-la."
                : "Modification bloquée : vérifiez les références d’offres, la capacité TG, les noms distincts et les affectations aux offres déjà sélectionnées. Aucun changement.",
      },
    ],
  });
}
