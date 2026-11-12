import { useState } from "react";
import { Text, View, Linking } from "react-native";
import { router } from "expo-router";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import {
  addContextDays,
  parisDate,
  type WeeklyContext,
} from "@fl-copilot/domain";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { contextIsStale } from "./weekly-context-repository";
import { useWeeklyContext } from "./use-weekly-context";
function dateLabel(s: string) {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  });
}
function number(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}
function freshness(
  p:
    | WeeklyContext["weather"]
    | WeeklyContext["publicHolidays"]
    | WeeklyContext["schoolHolidays"],
  now: Date,
) {
  if (!p.retrievedAt) return null;
  return `${contextIsStale(p, now) ? "Données anciennes · " : ""}Récupérées le ${new Date(p.retrievedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}
export function WeeklyContextView({
  storeId,
  weekStart: requestedWeek,
}: {
  storeId: string;
  weekStart?: string;
}) {
  const week = currentCommercialWeek(
    requestedWeek ? new Date(`${requestedWeek}T12:00:00Z`) : new Date(),
  );
  const weekStart = week.start;
  const {
    settings,
    context: validContext,
    busy,
    error,
    refresh,
  } = useWeeklyContext(storeId, weekStart);
  const [expanded, setExpanded] = useState(false);
  const [sourceError, setError] = useState<string>();
  const now = new Date();
  return (
    <SectionCard title="Contexte de la semaine">
      <Text>
        Semaine {week.number} · du {dateLabel(weekStart)} au{" "}
        {dateLabel(week.end)}
      </Text>
      <SecondaryButton
        label="Réglages du magasin"
        onPress={() => router.push("/store-settings")}
      />
      {!settings ? (
        <Text>
          Configurez votre magasin pour obtenir sa météo et son calendrier
          local.
        </Text>
      ) : (
        <>
          <Text>
            {settings.entity.city} · {settings.entity.postalCode}
          </Text>
          <SecondaryButton
            label={
              busy
                ? "Actualisation en cours…"
                : "Actualiser la météo et le calendrier"
            }
            disabled={busy}
            onPress={() => void refresh()}
          />
          {!validContext ? (
            <Text>
              Aucun contexte téléchargé pour ces réglages. Actualisez avec une
              connexion ; votre plan reste disponible.
            </Text>
          ) : (
            <>
              <SecondaryButton
                label={
                  expanded
                    ? "Réduire le détail du contexte"
                    : "Voir les sept jours et les sources"
                }
                onPress={() => setExpanded(!expanded)}
              />
              <Text accessibilityRole="header">Prévisions météo</Text>
              <Text>
                Températures min/max indicatives calculées sur les points de
                prévision disponibles. Pluie cumulée affichée uniquement si la
                journée est entièrement couverte.
              </Text>
              {freshness(validContext.weather, now) ? (
                <Text>{freshness(validContext.weather, now)}</Text>
              ) : null}
              {validContext.weather.issuedAt ? (
                <Text>
                  Prévision émise le{" "}
                  {new Date(validContext.weather.issuedAt).toLocaleString(
                    "fr-FR",
                    { timeZone: "Europe/Paris" },
                  )}
                </Text>
              ) : null}
              {validContext.weather.issue === "CITY_NOT_FOUND" ||
              validContext.weather.issue === "CITY_AMBIGUOUS" ? (
                <Text>
                  Commune non résolue avec certitude. Vérifiez son nom et son
                  code postal ou enregistrez un point précis.
                </Text>
              ) : null}
              {Array.from({ length: 7 }, (_, i) => {
                const date = addContextDays(weekStart, i),
                  d = validContext.weather.days.find(
                    (v) => v.validDate === date,
                  );
                if (
                  !expanded &&
                  (date < week.date || date > addContextDays(week.date, 1))
                )
                  return null;
                return (
                  <View key={date}>
                    <Text>
                      {dateLabel(date)} :{" "}
                      {d?.temperatureSampleCount
                        ? `${number(d.temperatureMinC!)} à ${number(d.temperatureMaxC!)} °C`
                        : validContext.weather.status === "UNAVAILABLE"
                          ? "Prévision indisponible"
                          : date < parisDate(now.toISOString())
                            ? "Prévision historique indisponible"
                            : "Météo pas encore disponible"}
                      {d?.temperatureSampleCount
                        ? ` · ${d.precipitationMm === null ? "pluie : données incomplètes" : `${number(d.precipitationMm)} mm de pluie prévue`}`
                        : ""}
                    </Text>
                  </View>
                );
              })}
              <SecondaryButton
                label="Source météo : MET Norway (CC BY 4.0)"
                onPress={() =>
                  void Linking.openURL(validContext.weather.sourceUrl).catch(
                    () => setError("Le lien source ne peut pas être ouvert."),
                  )
                }
              />
              <Text accessibilityRole="header">
                Jours fériés · Calendrier national
              </Text>
              {freshness(validContext.publicHolidays, now) ? (
                <Text>{freshness(validContext.publicHolidays, now)}</Text>
              ) : null}
              {validContext.publicHolidays.status === "UNAVAILABLE" ? (
                <Text>Calendrier indisponible.</Text>
              ) : validContext.publicHolidays.days.length ? (
                validContext.publicHolidays.days.map((d) => (
                  <Text key={d.date}>
                    {dateLabel(d.date)} · {d.label}
                  </Text>
                ))
              ) : (
                <Text>Aucun jour férié annoncé cette semaine.</Text>
              )}
              <SecondaryButton
                label="Source : calendrier national"
                onPress={() =>
                  void Linking.openURL(
                    validContext.publicHolidays.sourceUrl,
                  ).catch(() =>
                    setError("Le lien source ne peut pas être ouvert."),
                  )
                }
              />
              <Text accessibilityRole="header">
                Vacances scolaires
                {validContext.schoolHolidays.zone
                  ? ` · Zone ${validContext.schoolHolidays.zone}`
                  : ""}
              </Text>
              {freshness(validContext.schoolHolidays, now) ? (
                <Text>{freshness(validContext.schoolHolidays, now)}</Text>
              ) : null}
              {validContext.schoolHolidays.status === "NOT_CONFIGURED" ? (
                <Text>Choisissez la zone scolaire dans Mon magasin.</Text>
              ) : validContext.schoolHolidays.status === "UNAVAILABLE" ? (
                <Text>Calendrier scolaire indisponible.</Text>
              ) : validContext.schoolHolidays.periods.length ? (
                validContext.schoolHolidays.periods.map((p, i) => (
                  <Text key={`${p.startDate}-${i}`}>
                    {p.label} · départ après la classe le{" "}
                    {dateLabel(p.startDate)}, reprise le{" "}
                    {dateLabel(p.resumeDate)}
                    {p.population && p.population !== "-"
                      ? ` (${p.population})`
                      : ""}
                    .
                  </Text>
                ))
              ) : (
                <Text>Aucune période de vacances annoncée cette semaine.</Text>
              )}
              <SecondaryButton
                label="Source : Éducation nationale"
                onPress={() =>
                  void Linking.openURL(
                    validContext.schoolHolidays.sourceUrl,
                  ).catch(() =>
                    setError("Le lien source ne peut pas être ouvert."),
                  )
                }
              />
              <Text>
                Calendrier national hors jours fériés locaux. Prévisions et
                calendrier sont des éléments de contexte. Ils ne prédisent pas
                une hausse de ventes.
              </Text>
            </>
          )}
        </>
      )}
      {error || sourceError ? (
        <InlineAlert
          title="Contexte incomplet"
          message={error ?? sourceError!}
        />
      ) : null}
    </SectionCard>
  );
}
