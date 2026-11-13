import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { parisDate, type WeeklyContext } from "@fl-copilot/domain";
import {
  JournalObservedWeather,
  observedValue,
} from "./journal-observed-weather";
import { journalColors as c } from "./journal-theme";
import { BottomSheet, InlineAlert, SecondaryButton } from "../components/ui";
import { contextIsStale } from "../store/weekly-context-repository";
import {
  journalCalendar,
  journalDateLabel,
  journalWeatherDate,
  weatherNumber,
  weatherPresentation,
} from "./journal-presentation";

export function JournalWeather({
  date,
  context,
  location,
  busy,
  error,
  configured,
  onRefresh,
  onSettings,
}: {
  date: string;
  context: WeeklyContext | null;
  location: string;
  busy: boolean;
  error?: string;
  configured: boolean;
  onRefresh(): void;
  onSettings(): void;
}) {
  const [detail, setDetail] = useState(false),
    [linkError, setLinkError] = useState(false),
    [showForecast, setShowForecast] = useState(false);
  const now = new Date(),
    day = context?.weather.days.find((d) => d.validDate === date);
  const observing =
    date < parisDate(now.toISOString()) && !!context?.observedWeather;
  const observed = context?.observedWeather?.days.find(
    (d) => d.producerDate === date,
  );
  const forecastPresentation = weatherPresentation(day);
  const presentation = observing
      ? {
          icon: "thermometer-outline" as const,
          label: "Mesures de station",
          tone: "neutral" as const,
        }
      : forecastPresentation,
    stale =
      !!context &&
      contextIsStale(
        observing ? context.observedWeather! : context.weather,
        now,
      );
  const available = observing
    ? !!observed &&
      Object.values(observed.measurements).some((m) => m.analysisValue !== null)
    : !!day?.temperatureSampleCount || !!day?.symbol;
  const maximum = observing
    ? observedValue(observed?.measurements.TX.analysisValue)
    : day?.temperatureMaxC;
  const background = !available
    ? c.surface
    : presentation.tone === "sun"
      ? c.sun
      : presentation.tone === "rain"
        ? c.rain
        : c.neutral;
  const ink = !available
    ? c.muted
    : presentation.tone === "sun"
      ? c.sunInk
      : presentation.tone === "rain"
        ? c.rainInk
        : c.neutralInk;
  const symbolTime =
    !observing && day?.symbol
      ? new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        }).format(new Date(day.symbol.validFrom))
      : undefined;
  const calendar = journalCalendar(context, date, now);
  const timestamp = (value: string) =>
    new Date(value).toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    });
  async function source(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError(true);
    }
  }
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir le détail de la météo et du calendrier"
        onPress={() => {
          setShowForecast(false);
          setDetail(true);
        }}
        className="active:opacity-70"
        style={[styles.weather, { backgroundColor: background, opacity: 1 }]}
      >
        <Ionicons name={presentation.icon} size={31} color={ink} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={[styles.eyebrow, { color: ink }]}>
            {observing
              ? `Météo observée${stale ? " · ancienne" : ""}`
              : available
                ? `${journalWeatherDate(date, now)}${symbolTime ? ` · ${symbolTime}` : ""}${stale ? " · ancienne" : error ? " · à actualiser" : ""}`
                : "Météo"}
          </Text>
          <Text numberOfLines={1} style={[styles.condition, { color: ink }]}>
            {observing
              ? available
                ? context?.observedWeather?.reference?.station.name
                : "Mesure indisponible"
              : day?.symbol
                ? presentation.label
                : day?.temperatureSampleCount
                  ? "Températures prévues"
                  : configured
                    ? "Prévision indisponible"
                    : "Magasin à configurer"}
          </Text>
        </View>
        {maximum != null ? (
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text style={[styles.temperature, { color: ink }]}>
              {weatherNumber(maximum)}°
            </Text>
            <Text style={{ color: ink, fontSize: 10 }}>
              {observing ? "max. mesurée" : "max. indic."}
            </Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={16} color={ink} />
      </Pressable>
      <BottomSheet
        visible={detail}
        title="Météo et calendrier"
        swipeToClose
        onClose={() => setDetail(false)}
      >
        <Text className="text-lg font-semibold text-ink">
          {journalDateLabel(date)}
        </Text>
        <Text className="text-muted">{location}</Text>
        {error ? (
          <InlineAlert title="Contexte à actualiser" message={error} />
        ) : null}
        {observing ? (
          <JournalObservedWeather
            context={context!.observedWeather!}
            date={date}
            onSource={(url) => void source(url)}
          />
        ) : (
          <Text className="text-ink">
            {day?.precipitationMm == null
              ? "Cumul de pluie indisponible"
              : `${weatherNumber(day.precipitationMm)} mm prévus sur la journée`}
          </Text>
        )}
        {calendar.map((line) => (
          <Text key={line} className="text-ink">
            {line}
          </Text>
        ))}
        {observing && day?.temperatureSampleCount ? (
          <SecondaryButton
            label={
              showForecast
                ? "Masquer la prévision archivée"
                : "Consulter la prévision archivée"
            }
            onPress={() => setShowForecast((v) => !v)}
          />
        ) : null}
        {!observing || showForecast ? (
          <>
            {observing ? (
              <Text className="text-lg font-semibold text-ink">
                Prévision archivée · distincte des mesures
              </Text>
            ) : null}
            <Text className="text-ink">
              Les températures min/max sont indicatives, calculées sur les
              points de prévision disponibles. Le cumul de pluie est affiché
              seulement si toute la journée est couverte.
            </Text>
            {day?.temperatureSampleCount ? (
              <Text className="text-ink">
                De {weatherNumber(day.temperatureMinC)} à{" "}
                {weatherNumber(day.temperatureMaxC)} °C ·{" "}
                {day.temperatureSampleCount} points de prévision.
              </Text>
            ) : null}
            {day?.symbol ? (
              <Text className="text-muted">
                {forecastPresentation.label} · fenêtre de prévision du{" "}
                {timestamp(day.symbol.validFrom)} au{" "}
                {timestamp(day.symbol.validTo)}. Ce symbole ne résume pas toute
                la journée.
              </Text>
            ) : null}
            {context?.weather.retrievedAt ? (
              <Text className="text-muted">
                {stale ? "Données anciennes · " : ""}Récupérées le{" "}
                {timestamp(context.weather.retrievedAt)}.
              </Text>
            ) : null}
            {context?.weather.issuedAt ? (
              <Text className="text-muted">
                Prévision émise le {timestamp(context.weather.issuedAt)}.
              </Text>
            ) : null}
            <Text className="text-muted">
              Une prévision archivée reste une prévision : elle n’est pas une
              mesure météo observée. La météo ne démontre pas à elle seule un
              effet sur les ventes.
            </Text>
          </>
        ) : null}
        {context ? (
          <>
            {!observing || showForecast ? (
              <SecondaryButton
                label="Source météo · MET Norway · CC BY 4.0"
                onPress={() => void source(context.weather.sourceUrl)}
              />
            ) : null}
            <Text className="text-muted">
              Calendrier national :{" "}
              {context.publicHolidays.status === "UNAVAILABLE"
                ? "indisponible"
                : contextIsStale(context.publicHolidays, now)
                  ? "ancien"
                  : "disponible"}
              . Calendrier scolaire :{" "}
              {context.schoolHolidays.status === "UNAVAILABLE" ||
              context.schoolHolidays.status === "NOT_CONFIGURED"
                ? "à configurer ou indisponible"
                : contextIsStale(context.schoolHolidays, now)
                  ? "ancien"
                  : "disponible"}
              .
            </Text>
            <SecondaryButton
              label="Source · calendrier national"
              onPress={() => void source(context.publicHolidays.sourceUrl)}
            />
            <SecondaryButton
              label="Source · Éducation nationale"
              onPress={() => void source(context.schoolHolidays.sourceUrl)}
            />
          </>
        ) : null}
        {linkError ? (
          <Text className="text-critical">
            Le lien source ne peut pas être ouvert.
          </Text>
        ) : null}
        <SecondaryButton
          label={
            busy ? "Actualisation…" : "Actualiser la météo et le calendrier"
          }
          disabled={busy || !configured}
          onPress={onRefresh}
        />
        <SecondaryButton
          label="Réglages du magasin"
          onPress={() => {
            setDetail(false);
            onSettings();
          }}
        />
      </BottomSheet>
    </View>
  );
}
const styles = StyleSheet.create({
  weather: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 10,
    minHeight: 59,
    borderRadius: 13,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  condition: { fontSize: 16, lineHeight: 19, fontWeight: "600" },
  temperature: {
    fontSize: 24,
    lineHeight: 27,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
