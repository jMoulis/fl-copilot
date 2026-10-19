import {
  layoutScenarioInputSchema,
  layoutScenarioSourcesSchema,
  storeLayoutScenarioSchema,
  validateStoreLayoutReadSnapshot,
  type StoreLayoutContent,
} from "@fl-copilot/domain";
import { checkStoreLayoutGeometry } from "./store-layout-geometry";
import { commercialChoiceWithinWeek } from "./offer-choice";
export function layoutAllocationTargetLabel(
  c: StoreLayoutContent,
  furnitureId: string,
  surfaceId: string | null,
) {
  const f = c.furniture.find((x) => x.id === furnitureId);
  if (!f) throw Error("Le meuble choisi est absent du plan de référence.");
  const s = surfaceId
    ? c.surfaces.find((x) => x.id === surfaceId && x.furnitureId === f.id)
    : null;
  if (surfaceId && !s)
    throw Error("La surface choisie n’appartient pas au meuble de référence.");
  const a = f.assemblyId
    ? c.assemblies.find((x) => x.id === f.assemblyId)
    : null;
  const prefix = a ? `${a.label} · Face ${f.face} · ` : "";
  return `${prefix && !f.label.startsWith(prefix) ? prefix : ""}${f.label} · ${s ? s.label : "meuble entier, surfaces non réparties"}`;
}
/** Read-only allocation; no rectangles, coordinates, dimensions, quantities or business status are changed. */
export function prepareStoreLayoutScenario(
  storeId: string,
  raw: unknown,
  rawSources: unknown,
) {
  const input = layoutScenarioInputSchema.parse(raw),
    sources = layoutScenarioSourcesSchema.parse(rawSources),
    { head, reference } = validateStoreLayoutReadSnapshot(
      storeId,
      sources.layout,
    );
  if (
    [...sources.products, ...sources.choices].some(
      (x) => x.storeId !== storeId,
    ) ||
    new Set(sources.products.map((p) => p.id)).size !==
      sources.products.length ||
    new Set(sources.choices.map((p) => p.id)).size !== sources.choices.length
  )
    throw Error("LAYOUT_SCENARIO_SCOPE_INVALID");
  const fail = (
    status: "ABSENT" | "NO_REFERENCE" | "STALE" | "BLOCKED",
    message: string,
  ) => ({ input, status, scenario: null, message });
  if (!head)
    return fail(
      "ABSENT",
      "Aucun plan synchronisé disponible. Un plan local peut encore être en attente d’envoi.",
    );
  if (!reference)
    return fail(
      "NO_REFERENCE",
      "Le plan n’a pas de référence adoptée synchronisée. Le brouillon ne constitue pas automatiquement le plan de référence.",
    );
  if (input.expectedRevisionId !== reference.revisionId)
    return fail(
      "STALE",
      "La référence adoptée a changé. Relisez le plan avant de préparer les affectations.",
    );
  try {
    const items = [],
      seen = new Set<string>();
    for (const ref of input.assignments.flatMap((a) => a.items)) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const offer =
        ref.kind === "OFFER"
          ? sources.choices.find((x) => x.id === ref.id)
          : null;
      if (
        ref.kind === "OFFER" &&
        (!offer ||
          offer.status !== "RETAINED" ||
          !commercialChoiceWithinWeek(offer, {
            start: input.weekStart,
            end: new Date(
              Date.parse(input.weekStart + "T00:00:00Z") + 6 * 86400000,
            )
              .toISOString()
              .slice(0, 10),
          }))
      )
        throw Error(
          "Une offre est absente, retirée ou hors de cette semaine. Choisissez une référence retenue et applicable.",
        );
      const p = sources.products.find(
        (x) => x.id === (offer?.productId ?? ref.id),
      );
      if (!p || p.status !== "ACTIVE" || p.deletedAt)
        throw Error(
          "Un produit est absent ou inactif. Confirmez son identité avant de l’affecter.",
        );
      items.push({
        kind: ref.kind,
        id: ref.id,
        version: offer?.version ?? p.version,
        productId: p.id,
        productVersion: p.version,
        label: offer?.rawProductLabel ?? p.label,
        nature: p.nature,
        salesUnit: p.salesUnit,
        source: offer?.source ?? null,
        saleStart: offer?.saleStart ?? null,
        saleEnd: offer?.saleEnd ?? null,
      });
    }
    const assignments = input.assignments.map((a) => ({
      ...a,
      targetLabel: layoutAllocationTargetLabel(
        reference.content,
        a.furnitureId,
        a.surfaceId,
      ),
    }));
    const report = checkStoreLayoutGeometry(reference.content);
    const scenario = storeLayoutScenarioSchema.parse({
      status: "PROPOSED",
      storeId,
      physicalRevisionId: reference.revisionId,
      physicalVersion: reference.version,
      weekStart: input.weekStart,
      title: input.title,
      assumptions: input.assumptions,
      assignments,
      items: items.sort((a, b) =>
        `${a.kind}:${a.id}` < `${b.kind}:${b.id}` ? -1 : 1,
      ),
      geometry: {
        status: report.status,
        blocking: report.issues.filter((x) => x.severity === "BLOCKING").length,
        missing: report.issues.filter((x) => x.severity === "MISSING").length,
      },
    });
    return {
      input,
      status: "READY" as const,
      scenario,
      message:
        "Proposition d’affectation liée à la référence physique adoptée. Les meubles restent fixes. Aucun plan commercial n’est validé et aucune installation n’est déclarée ; stock, capacité et faisabilité globale restent inconnus.",
    };
  } catch (error) {
    return fail(
      "BLOCKED",
      error instanceof Error && !error.message.startsWith("[")
        ? error.message
        : "Vérifiez les cibles et les références produits/offres de la proposition.",
    );
  }
}
