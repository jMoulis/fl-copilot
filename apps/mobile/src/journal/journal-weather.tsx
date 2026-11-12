import { useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { WeeklyContext } from "@fl-copilot/domain";
import { colors } from "../design/tokens";
import { BottomSheet, SecondaryButton } from "../components/ui";
import { contextIsStale } from "../store/weekly-context-repository";
import {
  journalCalendar,
  journalDateLabel,
  journalWeatherDate,
  journalWeekDates,
  weatherNumber,
  weatherPresentation,
} from "./journal-presentation";

export function JournalWeather({
  date,
  weekStart,
  context,
  location,
  busy,
  configured,
  onSelectDate,
  onRefresh,
  onSettings,
}: {
  date: string;
  weekStart: string;
  context: WeeklyContext | null;
  location: string;
  busy: boolean;
  configured: boolean;
  onSelectDate(date: string): void;
  onRefresh(): void;
  onSettings(): void;
}) {
  const [detail, setDetail] = useState(false),
    [linkError, setLinkError] = useState(false);
  const now = new Date(),
    day = context?.weather.days.find((d) => d.validDate === date);
  const presentation = weatherPresentation(day),
    stale = !!context && contextIsStale(context.weather, now);
  const tint =
    presentation.tone === "sun"
      ? colors.warning
      : presentation.tone === "rain"
        ? colors.info
        : colors.muted;
  const symbolTime = day?.symbol
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
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le détail de la météo et du calendrier"
          onPress={() => setDetail(true)}
          style={({ pressed }) => [styles.hero, { opacity: pressed ? 0.8 : 1 }]}
        >
          <View style={styles.place}>
            <Ionicons name="location-outline" size={14} color={colors.muted} />
            <Text style={styles.muted}>{location}</Text>
          </View>
          <View style={styles.body}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={styles.temperature}>
                {weatherNumber(day?.temperatureMaxC)}
                {day?.temperatureMaxC == null ? "" : "°"}
              </Text>
              <Text style={styles.condition}>
                {day?.symbol
                  ? presentation.label
                  : day?.temperatureSampleCount
                    ? "Températures prévues"
                    : configured
                      ? "Météo à actualiser"
                      : "Ton magasin à configurer"}
              </Text>
              <Text style={styles.caption}>
                {day?.temperatureSampleCount
                  ? `${journalWeatherDate(date, now)} · maximum indicatif${stale ? " · ancienne" : ""}`
                  : "Les observations terrain restent disponibles"}
              </Text>
              {symbolTime ? (
                <Text style={styles.caption}>
                  Conditions prévues à {symbolTime}
                </Text>
              ) : null}
            </View>
            <View
              style={[
                styles.art,
                {
                  backgroundColor:
                    presentation.tone === "sun"
                      ? colors.warningSoft
                      : colors.surfaceMuted,
                },
              ]}
              accessible={false}
            >
              <Ionicons name={presentation.icon} size={66} color={tint} />
            </View>
          </View>
          <View style={styles.metadata}>
            <View style={styles.place}>
              <Ionicons name="water-outline" size={14} color={colors.info} />
              <Text style={styles.caption}>
                {day?.precipitationMm == null
                  ? "Cumul pluie non disponible"
                  : `${weatherNumber(day.precipitationMm)} mm prévus sur la journée`}
              </Text>
            </View>
            <Ionicons
              name="information-circle-outline"
              size={19}
              color={colors.muted}
            />
          </View>
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {journalWeekDates(weekStart).map((d) => {
            const item = context?.weather.days.find((x) => x.validDate === d),
              p = weatherPresentation(item),
              selected = d === date;
            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={`${journalDateLabel(d)}, ${item?.symbol ? p.label : "prévision"}, maximum ${weatherNumber(item?.temperatureMaxC)} degrés`}
                accessibilityState={{ selected }}
                onPress={() => onSelectDate(d)}
                style={[styles.day, selected && styles.selected]}
              >
                <Text
                  style={[styles.caption, selected && { color: colors.ink }]}
                >
                  {journalDateLabel(d, true).replace(".", "")}
                </Text>
                <Ionicons
                  name={p.icon}
                  size={22}
                  color={
                    p.tone === "sun"
                      ? colors.warning
                      : p.tone === "rain"
                        ? colors.info
                        : colors.muted
                  }
                />
                <Text style={styles.dayTemperature}>
                  {weatherNumber(item?.temperatureMaxC)}
                  {item?.temperatureMaxC == null ? "" : "°"}
                </Text>
                <Text style={styles.caption}>{Number(d.slice(-2))}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {calendar.map((line) => (
        <View key={line} style={styles.place}>
          <Ionicons name="calendar-outline" size={14} color={colors.forest} />
          <Text style={[styles.caption, { flex: 1 }]}>{line}</Text>
        </View>
      ))}
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
        <Text className="text-ink">
          Les températures min/max sont indicatives, calculées sur les points de
          prévision disponibles. Le cumul de pluie est affiché seulement si
          toute la journée est couverte.
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
            {presentation.label} · fenêtre de prévision du{" "}
            {timestamp(day.symbol.validFrom)} au {timestamp(day.symbol.validTo)}
            . Ce symbole ne résume pas toute la journée.
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
          Une prévision archivée reste une prévision : elle n’est pas une mesure
          météo observée. La météo ne démontre pas à elle seule un effet sur les
          ventes.
        </Text>
        {context ? (
          <>
            <SecondaryButton
              label="Source météo · MET Norway · CC BY 4.0"
              onPress={() => void source(context.weather.sourceUrl)}
            />
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  hero: { padding: 20, gap: 16 },
  place: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  caption: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  body: { flexDirection: "row", alignItems: "center", gap: 12 },
  temperature: {
    color: colors.ink,
    fontSize: 52,
    fontWeight: "300",
    letterSpacing: -2,
  },
  condition: { color: colors.ink, fontSize: 16 },
  art: {
    width: 92,
    height: 92,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  metadata: {
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  strip: { paddingHorizontal: 10, paddingBottom: 12, gap: 4 },
  day: {
    width: 46,
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selected: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.forestStrong,
  },
  dayTemperature: { color: colors.ink, fontSize: 13, fontWeight: "500" },
});
