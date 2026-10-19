import { createHash } from "node:crypto";
import { z } from "zod";
import { copilotEvidenceSchema } from "@fl-copilot/domain";
import { checkImplantationScenario } from "@fl-copilot/commercial-core";

/** Pure simulation. The authenticated store comes from the server, never tool arguments. */
export function readImplantationScenario(storeId: string, raw: unknown) {
  z.uuid().parse(storeId);
  const scenario = checkImplantationScenario(raw);
  const revision = createHash("sha256")
    .update(JSON.stringify([storeId, scenario.schemaVersion, scenario.input]))
    .digest("hex");
  const sourceId = `implantation/${revision}`;
  const cm = (v: number | null) => (v === null ? "inconnu" : `${v / 10} cm`);
  const labels = {
    CHECKED: "Contrôles géométriques renseignés sans anomalie détectée",
    INCOMPLETE: "Contrôles incomplets : mesures ou contraintes à préciser",
    BLOCKED: "Placement à corriger : au moins une contrainte non respectée",
  };
  const rows: Array<{
    label: string;
    value: string | number;
    detail?: string;
  }> = [
    {
      label: "Scénario d’implantation provisoire",
      value: labels[scenario.status],
      detail:
        "Hypothèses de travail, pas des mesures magasin confirmées. Coordonnées depuis le coin supérieur gauche ; x vers la droite, y vers le bas. Contrôle de rectangles à plat uniquement : aucune garantie de conformité réglementaire, de continuité entrée/sortie, de stabilité ou de faisabilité réelle. Les passages et minima sont ceux du scénario, sans norme déduite. Aucune implantation ni contrainte magasin n’est enregistrée.",
    },
    {
      label: "Zone du scénario",
      value: `Largeur : ${cm(scenario.input.space.widthMm)} ; profondeur : ${cm(scenario.input.space.depthMm)} ; hauteur maximale : ${cm(scenario.input.space.maxHeightMm)}.`,
    },
    { label: "TG prévues dans le scénario", value: scenario.counts.TG },
    { label: "Îlots prévus dans le scénario", value: scenario.counts.ISLAND },
  ];
  for (const item of [
    ...scenario.input.fixtures.map((item) => ({
      ...item,
      objectType: "FIXTURE" as const,
    })),
    ...(scenario.input.obstacles ?? []).map((item) => ({
      ...item,
      objectType: "OBSTACLE" as const,
    })),
    ...(scenario.input.reservedAreas ?? []).map((item) => ({
      ...item,
      objectType: "RESERVATION" as const,
    })),
  ]) {
    const footprint = scenario.footprints.find((f) => f.id === item.id);
    rows.push({
      label: item.label,
      value:
        `Position x : ${cm(item.xMm)} ; y : ${cm(item.yMm)}. Emprise orientée : ${footprint ? `${cm(footprint.widthMm)} × ${cm(footprint.depthMm)}` : "incomplète"}.` +
        (item.objectType === "FIXTURE"
          ? ` Rotation : ${item.rotation}°. Hauteur : ${cm(item.heightMm)}. Charge prévue : ${item.loadKg === null ? "inconnue" : `${item.loadKg} kg`} ; maximale : ${item.maxLoadKg === null ? "inconnue" : `${item.maxLoadKg} kg`}.`
          : "") +
        (item.objectType === "RESERVATION"
          ? ` Largeur minimale réservée : ${cm(item.minimumWidthMm)}.`
          : ""),
    });
  }
  if (scenario.issues.length)
    rows.push({
      label: "Points à vérifier dans le scénario",
      value:
        scenario.issues
          .slice(0, 25)
          .map((i) => i.message)
          .join("\n") +
        (scenario.issues.length > 25
          ? "\nD’autres anomalies sont présentes : corriger ces premiers points puis recalculer."
          : ""),
    });
  return {
    storeId,
    revision,
    scenario,
    evidence: rows.map((row, index) =>
      copilotEvidenceSchema.parse({
        id: `${sourceId}/${index}`,
        sourceType: "DATA_QUALITY",
        sourceId,
        sourceVersion: 1,
        factKind: "QUALITY",
        ...row,
      }),
    ),
  };
}
