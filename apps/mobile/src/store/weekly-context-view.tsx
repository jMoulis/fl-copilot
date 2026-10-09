import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, Linking } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ApiClient } from "@fl-copilot/api-client";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import {
  addContextDays,
  parisDate,
  storeContextFingerprint,
  type WeeklyContext,
} from "@fl-copilot/domain";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { getApiBaseUrl } from "@/config/environment";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import {
  StoreContextRepository,
  type LocalStoreContext,
} from "./context-repository";
import {
  WeeklyContextRepository,
  contextIsStale,
} from "./weekly-context-repository";
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
export function WeeklyContextView({ storeId }: { storeId: string }) {
  const { sqlite } = useLocalDatabase(),
    { withAccessToken } = useAuth(),
    { lastSyncedAt } = useSync();
  const settingsRepository = useMemo(
      () => new StoreContextRepository(sqlite),
      [sqlite],
    ),
    cache = useMemo(() => new WeeklyContextRepository(sqlite), [sqlite]),
    api = useMemo(() => new ApiClient(getApiBaseUrl()), []);
  const week = currentCommercialWeek(),
    weekStart = week.start;
  const [settings, setSettings] = useState<LocalStoreContext | null>(null),
    [context, setContext] = useState<WeeklyContext | null>(null),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState<string>();
  const watchLocal = useCallback(() => {
    let active = true;
    void settingsRepository
      .get(storeId)
      .then(async (s) => {
        const cached = s ? await cache.get(s.entity, weekStart) : null;
        if (active) {
          setSettings(s);
          setContext(cached);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Le contexte local ne peut pas être lu. Le plan reste disponible.",
          );
      });
    return () => {
      active = false;
    };
  }, [settingsRepository, cache, storeId, weekStart]);
  useFocusEffect(watchLocal);
  useEffect(() => {
    if (lastSyncedAt) return watchLocal();
  }, [lastSyncedAt, watchLocal]);
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const initial = await settingsRepository.get(storeId);
      if (!initial || initial.syncState !== "SYNCED")
        throw Error(
          "Enregistrez puis synchronisez les réglages dans Mon magasin.",
        );
      const result = await withAccessToken((token) =>
        api.weeklyContext(token, storeId, weekStart),
      );
      const latest = await settingsRepository.get(storeId);
      if (
        !latest ||
        storeContextFingerprint(latest.entity) !== result.settingsFingerprint
      )
        throw Error(
          "Les réglages du magasin ont changé. Synchronisez-les puis actualisez le contexte.",
        );
      const saved = await cache.save(result, latest.entity);
      setSettings(latest);
      setContext(saved);
      if (
        [result.weather, result.publicHolidays, result.schoolHolidays].some(
          (p) => p.status === "UNAVAILABLE" || p.status === "STALE",
        )
      )
        setError(
          "Une source est indisponible. Les dernières données disponibles sont conservées ; le plan reste utilisable.",
        );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Actualisation impossible. Le contexte enregistré reste disponible.",
      );
    } finally {
      setBusy(false);
    }
  }
  const validContext =
      settings &&
      settings.entity.storeId === storeId &&
      context?.storeId === storeId &&
      context.weekStart === weekStart &&
      context.settingsFingerprint === storeContextFingerprint(settings.entity)
        ? context
        : null,
    now = new Date();
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
      {error ? (
        <InlineAlert title="Contexte incomplet" message={error} />
      ) : null}
    </SectionCard>
  );
}
