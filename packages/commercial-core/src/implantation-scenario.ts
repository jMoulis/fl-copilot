import {
  implantationScenarioInputSchema,
  implantationScenarioResultSchema,
  type ImplantationScenarioResult,
} from "@fl-copilot/domain";

/** Bounded rectangular preflight. Never infers real measurements, legal clearances or route connectivity. */
export function checkImplantationScenario(
  raw: unknown,
): ImplantationScenarioResult {
  const input = implantationScenarioInputSchema.parse(raw);
  const issues: ImplantationScenarioResult["issues"] = [];
  const footprints: ImplantationScenarioResult["footprints"] = [];
  const missing = (target: string, label: string) =>
    issues.push({
      code: "MISSING_MEASUREMENT",
      severity: "MISSING",
      targets: [target],
      message: `${label} : mesure ou contrainte inconnue.`,
    });
  const blocked = (
    code: ImplantationScenarioResult["issues"][number]["code"],
    targets: string[],
    message: string,
  ) => issues.push({ code, severity: "BLOCKING", targets, message });
  for (const [key, label] of [
    ["widthMm", "Largeur de la zone"],
    ["depthMm", "Profondeur de la zone"],
    ["maxHeightMm", "Hauteur maximale autorisée"],
  ] as const)
    if (input.space[key] === null) missing(`space.${key}`, label);
  for (const [key, label] of [
    ["obstacles", "Obstacles fixes"],
    ["reservedAreas", "Passages et entrées à réserver"],
  ] as const)
    if (input[key] === null)
      issues.push({
        code: "INVENTORY_UNKNOWN",
        severity: "MISSING",
        targets: [key],
        message: `${label} : inventaire inconnu.`,
      });
  const counts = {
    TG: input.fixtures.filter((f) => f.kind === "TG").length,
    ISLAND: input.fixtures.filter((f) => f.kind === "ISLAND").length,
  };
  for (const kind of ["TG", "ISLAND"] as const) {
    const expected = input.expectedCounts[kind],
      label = kind === "TG" ? "TG" : "îlots";
    if (expected === null)
      issues.push({
        code: "COUNTS_UNKNOWN",
        severity: "MISSING",
        targets: [`expectedCounts.${kind}`],
        message: `Nombre attendu de ${label} non précisé.`,
      });
    else if (expected !== counts[kind])
      blocked(
        "COUNT_MISMATCH",
        [`expectedCounts.${kind}`],
        `Nombre de ${label} : ${counts[kind]} représentés pour ${expected} attendus.`,
      );
  }
  const objects = [
    ...input.fixtures.map((item) => ({
      ...item,
      objectType: "FIXTURE" as const,
    })),
    ...(input.obstacles ?? []).map((item) => ({
      ...item,
      objectType: "OBSTACLE" as const,
    })),
    ...(input.reservedAreas ?? []).map((item) => ({
      ...item,
      objectType: "RESERVATION" as const,
    })),
  ];
  for (const item of objects) {
    const rotated = item.objectType === "FIXTURE" && item.rotation === 90;
    const widthMm = rotated ? item.depthMm : item.widthMm;
    const depthMm = rotated ? item.widthMm : item.depthMm;
    for (const [field, label] of [
      ["xMm", "Position horizontale"],
      ["yMm", "Position verticale"],
      ["widthMm", "Largeur"],
      ["depthMm", "Profondeur"],
    ] as const)
      if (item[field] === null)
        missing(`${item.id}.${field}`, `${item.label} — ${label}`);
    const outside = (
      origin: number | null,
      extent: number | null,
      limit: number | null,
    ) =>
      limit !== null &&
      ((origin !== null && origin >= limit) ||
        (extent !== null && (origin ?? 0) + extent > limit));
    if (
      outside(item.xMm, widthMm, input.space.widthMm) ||
      outside(item.yMm, depthMm, input.space.depthMm)
    )
      blocked(
        "OUT_OF_BOUNDS",
        [item.id],
        `${item.label} dépasse la zone disponible.`,
      );
    if (
      item.widthMm !== null &&
      item.depthMm !== null &&
      item.xMm !== null &&
      item.yMm !== null
    ) {
      const box = {
        id: item.id,
        xMm: item.xMm,
        yMm: item.yMm,
        widthMm: rotated ? item.depthMm : item.widthMm,
        depthMm: rotated ? item.widthMm : item.depthMm,
      };
      footprints.push(box);
    }
    if (item.objectType === "FIXTURE") {
      if (item.heightMm === null)
        missing(`${item.id}.heightMm`, `${item.label} — hauteur`);
      else if (
        input.space.maxHeightMm !== null &&
        item.heightMm > input.space.maxHeightMm
      )
        blocked(
          "HEIGHT_EXCEEDED",
          [item.id],
          `${item.label} dépasse la hauteur maximale déclarée.`,
        );
      for (const [field, label] of [
        ["maxLoadKg", "Charge maximale"],
        ["loadKg", "Charge prévue"],
      ] as const)
        if (item[field] === null)
          missing(`${item.id}.${field}`, `${item.label} — ${label}`);
      if (
        item.maxLoadKg !== null &&
        item.loadKg !== null &&
        item.loadKg > item.maxLoadKg
      )
        blocked(
          "LOAD_EXCEEDED",
          [item.id],
          `${item.label} dépasse la charge maximale déclarée.`,
        );
    }
    if (item.objectType === "RESERVATION") {
      if (item.minimumWidthMm === null)
        missing(
          `${item.id}.minimumWidthMm`,
          `${item.label} — largeur minimale à réserver`,
        );
      else if (
        (item.widthMm !== null && item.widthMm < item.minimumWidthMm) ||
        (item.depthMm !== null && item.depthMm < item.minimumWidthMm)
      )
        blocked(
          "PASSAGE_TOO_NARROW",
          [item.id],
          `${item.label} est plus étroit que le minimum déclaré.`,
        );
    }
  }
  // Touching edges are not overlap. Passage reservations may join/overlap each other.
  const reserved = new Set((input.reservedAreas ?? []).map((a) => a.id));
  const obstacles = new Set((input.obstacles ?? []).map((a) => a.id));
  for (let i = 0; i < footprints.length; i++) {
    const a = footprints[i]!;
    for (const b of footprints.slice(i + 1)) {
      if (reserved.has(a.id) && reserved.has(b.id)) continue;
      if (obstacles.has(a.id) && obstacles.has(b.id)) continue;
      if (
        a.xMm < b.xMm + b.widthMm &&
        b.xMm < a.xMm + a.widthMm &&
        a.yMm < b.yMm + b.depthMm &&
        b.yMm < a.yMm + a.depthMm
      ) {
        const passage = reserved.has(a.id) || reserved.has(b.id);
        const label = (id: string) => objects.find((o) => o.id === id)!.label;
        blocked(
          passage ? "RESERVED_AREA_BLOCKED" : "COLLISION",
          [a.id, b.id],
          passage
            ? `${label(a.id)} et ${label(b.id)} se recouvrent : accès réservé obstrué.`
            : `${label(a.id)} et ${label(b.id)} se recouvrent.`,
        );
      }
    }
  }
  return implantationScenarioResultSchema.parse({
    schemaVersion: 1,
    authority: "PROVISIONAL",
    input,
    counts,
    footprints,
    issues,
    status: issues.some((i) => i.severity === "BLOCKING")
      ? "BLOCKED"
      : issues.length
        ? "INCOMPLETE"
        : "CHECKED",
  });
}
