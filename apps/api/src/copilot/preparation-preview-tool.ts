import {
  commercialChoiceWithinWeek,
  commercialPreparationOfferIssues,
} from "@fl-copilot/commercial-core";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  copilotPreparationPatchSchema,
  copilotPreparationPreviewSchema,
  prepareWeekPatch,
  preparationRequestSchema,
  validatePreparationBasis,
  commercialWeekPreparationSchema,
} from "@fl-copilot/domain";
import { loadCommercialPreparationContext } from "./commercial-preparation-tool.js";
/** Reuses canonical reference checks for missing-week creation or existing-draft edits; never writes. */
export async function readPreparationPreview(
  db: Db,
  storeId: string,
  raw: unknown,
) {
  const input = copilotPreparationPatchSchema.parse(raw);
  // At most 100 references, no unbounded source/product scan. All issue checks cover all references.
  const r = await loadCommercialPreparationContext(
    db,
    storeId,
    {
      weekStart: input.weekStart,
      offset: 0,
      limit: 10,
    },
    input.create?.choiceIds,
    input.patch.offerSelection?.addChoiceIds,
  );
  const all = r.all;
  let status:
    | "READY"
    | "UNCHANGED"
    | "UNAVAILABLE"
    | "BLOCKED"
    | "LIMIT_EXCEEDED"
    | "ALREADY_EXISTS" = "READY";
  let basis: ReturnType<typeof copilotPreparationPreviewSchema.parse>["basis"] =
    input.create
      ? r.preparation
        ? null
        : { preparation: null, creationStoreId: storeId, choices: all }
      : r.preparation
        ? { preparation: r.preparation, choices: all }
        : null;
  if (basis)
    try {
      validatePreparationBasis(storeId, input, basis);
    } catch {
      basis = null;
    }
  const removedIds = input.patch.offerSelection?.removeChoiceIds ?? [];
  const unresolvedTgs = (r.preparation?.placements ?? [])
    .filter((t) => !input.patch.tgRemovals?.includes(t.id))
    .filter((t) =>
      (
        input.patch.tgUpdates?.find((u) => u.placementId === t.id)?.offerIds ??
        t.offerIds
      ).some((id) => removedIds.includes(id)),
    );
  if (input.create && r.preparation) status = "ALREADY_EXISTS";
  else if (!basis) status = "UNAVAILABLE";
  else if (r.issues.length && !input.patch.offerSelection) status = "BLOCKED";
  else
    try {
      const request = prepareWeekPatch(
        input,
        basis,
        "00000000-0000-4000-8000-000000000001",
      );
      if (
        input.create &&
        all.some(
          (c) =>
            c.status !== "RETAINED" ||
            !commercialChoiceWithinWeek(c, {
              start: request.input.draft.weekStart,
              end: request.input.draft.weekEnd,
            }),
        )
      )
        status = "BLOCKED";
      if (
        input.patch.offerSelection &&
        basis.preparation &&
        commercialPreparationOfferIssues(
          commercialWeekPreparationSchema.parse({
            ...basis.preparation,
            ...request.input.draft,
          }),
          all,
        ).length
      )
        status = "BLOCKED";
      const current = basis.preparation
        ? preparationRequestSchema.shape.input.shape.draft
            .strip()
            .parse(basis.preparation)
        : null;
      if (JSON.stringify(current) === JSON.stringify(request.input.draft))
        status = "UNCHANGED";
    } catch {
      status = "BLOCKED";
    }
  // Keep complete review snapshots inside the existing 16k private-message contract.
  // Reserve room for the kind/version/assistant binding; never truncate a review.
  if (JSON.stringify({ input, basis }).length > 15000) {
    status = "LIMIT_EXCEEDED";
    basis = null;
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
          status === "ALREADY_EXISTS"
            ? "Un brouillon synchronisé existe déjà pour cette semaine. Consultez-le puis préparez une modification ; il ne sera pas remplacé par une création."
            : status === "LIMIT_EXCEEDED"
              ? "Ce brouillon est trop volumineux pour une carte de confirmation complète. Modifiez-le dans l’écran de préparation hebdomadaire ; aucune donnée n’a été tronquée ni enregistrée."
              : status === "READY"
                ? input.create
                  ? "Nouvelle semaine préparée à partir des offres retenues sélectionnées, à confirmer sur l’appareil. Aucune validation commerciale, publication ou installation en rayon."
                  : "Modification préparée, à confirmer sur l’appareil. Le brouillon sera enregistré localement ; aucune validation de plan ni installation en rayon."
                : status === "UNCHANGED"
                  ? "Le brouillon contient déjà ces valeurs ; aucun changement."
                  : status === "UNAVAILABLE"
                    ? input.create
                      ? "Certaines offres retenues sélectionnées ne sont pas disponibles dans ce magasin. Vérifiez leur sélection et leur synchronisation ; aucun brouillon créé."
                      : "Le brouillon ou ses offres ne sont pas disponibles. Ouvrez ou créez la préparation hebdomadaire, puis synchronisez-la."
                    : unresolvedTgs.length
                      ? `Les offres à retirer restent affectées aux TG suivantes : ${unresolvedTgs.map((t) => t.label).join(" ; ")}. Précisez leurs nouvelles affectations ou leur retrait ; aucune TG ni affectation ne sera retirée automatiquement.`
                      : "Modification bloquée : vérifiez les références d’offres, la capacité TG, les noms distincts, les TG à retirer ou modifier et les affectations aux offres déjà sélectionnées. Aucun changement.",
      },
    ],
  });
}
