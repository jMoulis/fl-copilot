import { createHash } from "node:crypto";
import { z } from "zod";
import {
  copilotWeekInputSchema,
  copilotWeekResultSchema,
  copilotEvidenceSchema,
  weeklyContextSchema,
} from "@fl-copilot/domain";
import { AuthError } from "../auth/service.js";
import type { WeekContextService } from "../context/week-context.js";

/** Reuses the authorized store-context service and its independent public-provider cache. */
export async function readCopilotWeek(
  service: WeekContextService,
  storeId: string,
  raw: unknown,
  now = new Date(),
) {
  z.string().uuid().parse(storeId);
  const input = copilotWeekInputSchema.parse(raw);
  let context: z.infer<typeof copilotWeekResultSchema>["context"] = null;
  try {
    const source = weeklyContextSchema.parse(
      await service.read(storeId, input.weekStart),
    );
    if (
      source.storeId !== storeId ||
      source.weekStart !== input.weekStart ||
      source.publicHolidays.days.some(
        (d) => d.date < source.weekStart || d.date > source.weekEnd,
      ) ||
      source.schoolHolidays.periods.some(
        (p) => p.startDate > source.weekEnd || p.resumeDate <= source.weekStart,
      )
    )
      throw Error("COPILOT_WEEK_SCOPE_INVALID");
    const { settingsFingerprint, ...visible } = source;
    void settingsFingerprint;
    context = visible;
    for (const key of [
      "weather",
      "publicHolidays",
      "schoolHolidays",
    ] as const) {
      const provider = context[key];
      if (
        provider.status === "AVAILABLE" &&
        (!provider.validUntil ||
          Date.parse(provider.validUntil) <= now.getTime())
      )
        provider.status = "STALE";
    }
  } catch (error) {
    if (!(
      error instanceof AuthError &&
      error.publicCode === "STORE_SETTINGS_NOT_SYNCED"
    ))
      throw error;
  }
  const revision = createHash("sha256")
    .update(JSON.stringify([storeId, input, context]))
    .digest("hex");
  const evidence: z.infer<typeof copilotEvidenceSchema>[] = [];
  const states = {
    AVAILABLE: "Disponible",
    STALE: "Périmé ou fournisseur indisponible",
    UNAVAILABLE: "Indisponible",
    NOT_CONFIGURED: "Non configuré",
  };
  const stamp = (s: string | null) => s ?? "non connue";
  const meta = (p: NonNullable<typeof context>["weather"]) =>
    `${states[p.status]}. Relevé ${stamp(p.retrievedAt)} ; validité jusqu'à ${stamp(p.validUntil)}. Source : ${p.provider} — ${p.sourceUrl}.`;
  const fact = (
    key: string,
    label: string,
    value: string,
    sourceId: string,
    factKind: "DERIVED" | "QUALITY",
  ) =>
    copilotEvidenceSchema.parse({
      id: `store-week/${revision}/${key}`,
      sourceType: factKind === "QUALITY" ? "DATA_QUALITY" : "SOURCE_DOCUMENT",
      sourceId,
      sourceVersion: null,
      label,
      value,
      factKind,
    });
  if (context) {
    const c = context,
      w = c.weather;
    evidence.push(
      fact(
        "weather",
        `Prévisions météo — ${c.locationLabel}`,
        `${meta(w)} Émission ${stamp(w.issuedAt)}. ${w.days.length} jours de prévision disponibles sur cette semaine. ${w.days.map((d) => `${d.validDate} : température min ${d.temperatureMinC ?? "inconnue"} °C / max ${d.temperatureMaxC ?? "inconnue"} °C (${d.temperatureSampleCount} échantillons) ; pluie ${d.precipitationMm ?? "inconnue"} mm, couverture ${d.precipitationHours}/${d.dayHours} heures`).join(" ; ")}. Les jours absents et la pluie incomplète sont inconnus, pas nuls. Ce sont des prévisions, jamais une météo observée ni la cause démontrée des ventes.`,
        w.sourceUrl,
        "DERIVED",
      ),
    );
    const h = c.publicHolidays;
    evidence.push(
      fact(
        "holidays",
        "Jours fériés — calendrier métropolitain",
        `${states[h.status]}. Relevé ${stamp(h.retrievedAt)} ; validité jusqu'à ${stamp(h.validUntil)}. ${h.days.length ? h.days.map((d) => `${d.date} : ${d.label}`).join(" ; ") : h.status === "AVAILABLE" ? "Aucun jour férié dans la semaine demandée." : "Aucune absence de jour férié ne peut être établie avec ces données."} Source : ${h.provider} — ${h.sourceUrl}. Cela ne décrit pas les horaires ni la fréquentation du magasin.`,
        h.sourceUrl,
        "DERIVED",
      ),
    );
    const s = c.schoolHolidays;
    evidence.push(
      fact(
        "school",
        `Vacances scolaires — ${s.zone ? "zone " + s.zone : "zone à préciser"}`,
        `${states[s.status]}. Relevé ${stamp(s.retrievedAt)} ; validité jusqu'à ${stamp(s.validUntil)}. ${s.periods.length ? s.periods.map((p) => `${p.label} : départ ${p.startDate}, reprise ${p.resumeDate} (exclue)${p.population ? ", population : " + p.population : ""}`).join(" ; ") : s.status === "AVAILABLE" ? "Aucune période de vacances dans la semaine demandée." : "Aucune absence de vacances ne peut être établie ; préciser la zone ou actualiser la source."} Source : ${s.provider} — ${s.sourceUrl}. Ce calendrier ne prouve ni le départ des clients, ni un effet chiffré sur les ventes.`,
        s.sourceUrl,
        "DERIVED",
      ),
    );
  }
  evidence.push(
    fact(
      "coverage",
      `Contexte externe — semaine du ${input.weekStart}`,
      context
        ? "Semaine du lundi au dimanche, magasin et sources configurés. Les prévisions peuvent couvrir seulement une partie de la semaine ; conserver la fraîcheur et les données manquantes de chaque fournisseur. Contexte externe distinct des chiffres Mercalys, des observations magasin et des horaires d'ouverture. Aucun impact causal, stock, fréquentation ou chiffre de vente n'est calculé."
        : "Réglages du magasin absents ou non synchronisés. Demander la commune, le code postal et la zone scolaire si nécessaires ; aucun contexte local n'a été inventé. Les analyses déjà disponibles restent utilisables.",
      storeId,
      "QUALITY",
    ),
  );
  return copilotWeekResultSchema.parse({
    weekStart: input.weekStart,
    context,
    evidence,
  });
}
