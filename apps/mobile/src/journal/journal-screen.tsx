import { JournalTransports } from "./journal-transports";
import { JournalExternalContext } from "./journal-context";
import { JournalNotes } from "./journal-notes";
import clementineArt from "../../assets/journal/clementinier.webp";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { randomUUID } from "expo-crypto";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import {
  addContextDays,
  storeEventLabels,
  storeEventTimeLabel,
  parisDate,
} from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { useWeeklyContext } from "../store/use-weekly-context";
import {
  AppScreen,
  BottomSheet,
  InlineAlert,
  SecondaryButton,
} from "../components/ui";
import { MainHeader } from "../components/main-header";
import { tradingToday } from "../dates/calendar";
import { journalColors as c } from "./journal-theme";
import { SeverityBars } from "../needs/event-severity";
import { storeEventSyncState } from "../needs/store-event-presentation";
import { JournalEconomy } from "./journal-economy";
import { JournalWeather } from "./journal-weather";
import { journalDateLabel, journalWeekDates } from "./journal-presentation";
import { journalObservations } from "./journal-observations";

export default function JournalScreen() {
  const { session } = useAuth();
  const storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreJournal
      key={`${storeId}:${ownerId}`}
      storeId={storeId}
      ownerId={ownerId}
    />
  ) : (
    <AppScreen header={<MainHeader title="Journal" />}>
      <Text className="text-muted">
        Connecte-toi pour retrouver ton magasin.
      </Text>
    </AppScreen>
  );
}
function StoreJournal({
  storeId,
  ownerId,
}: {
  storeId: string;
  ownerId: string;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { lastSyncedAt } = useSync();
  const [today, setToday] = useState(tradingToday),
    [date, setDate] = useState(tradingToday);
  const weekStart = currentCommercialWeek(new Date(`${date}T12:00:00Z`)).start;
  const {
    settings,
    context,
    busy,
    error,
    collect: refresh,
  } = useWeeklyContext(storeId, weekStart, true);
  const [observations, setObservations] = useState<{
    date: string;
    rows: Awaited<ReturnType<typeof journalObservations>>;
  }>();
  const [selectedObservation, setSelectedObservation] =
    useState<Awaited<ReturnType<typeof journalObservations>>[number]>();
  const [localError, setLocalError] = useState<string>();
  const [preparing, setPreparing] = useState(false),
    draftLocked = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      const next = tradingToday();
      if (next !== today) {
        setToday(next);
        setDate((old) => (old === today ? next : old));
      }
    }, [today]),
  );
  const readObservations = useCallback(() => {
    let active = true;
    void journalObservations(sqlite, storeId, date, today)
      .then((rows) => {
        if (active) {
          setObservations({ date, rows });
          setLocalError(undefined);
        }
      })
      .catch(() => {
        if (active)
          setLocalError(
            "Les observations locales ne peuvent pas être lues. Elles restent conservées dans leur historique.",
          );
      });
    return () => {
      active = false;
    };
  }, [date, sqlite, storeId, today]);
  useFocusEffect(readObservations);
  useEffect(() => {
    if (lastSyncedAt) return readObservations();
  }, [lastSyncedAt, readObservations]);
  const visible = observations?.date === date ? observations.rows : [];
  async function analyze() {
    if (draftLocked.current) return;
    draftLocked.current = true;
    setPreparing(true);
    try {
      const [
        { CopilotConversationRepository },
        { CopilotLocalChatController },
      ] = await Promise.all([
        import("../copilot/conversation-repository"),
        import("../copilot/local-chat-controller"),
      ]);
      if (!alive.current) return;
      const controller = new CopilotLocalChatController(
        new CopilotConversationRepository(sqlite, { storeId, ownerId }),
        { storeId, ownerId, deviceId },
        randomUUID,
      );
      const conversation = await controller.create(`Journal du ${date}`);
      await controller.editText(
        conversation.id,
        `Fais le point sur la journée du ${date} pour mon rayon. Consulte les chiffres disponibles, les observations terrain et le contexte du Journal (météo observée, calendrier, annonces locales et conjoncture) de cette date si disponible. Compare des jours de semaine équivalents et distingue les faits des explications possibles. Une prévision archivée n’est pas une météo observée. Ne modifie rien.`,
      );
      if (alive.current)
        router.push({
          pathname: "/copilot",
          params: { conversationId: conversation.id },
        });
    } catch {
      if (alive.current)
        setLocalError(
          "La discussion ne peut pas être préparée. Tes observations restent conservées.",
        );
    } finally {
      draftLocked.current = false;
      if (alive.current) setPreparing(false);
    }
  }
  return (
    <AppScreen
      header={<MainHeader title="Journal" brand />}
      backgroundColor={c.canvas}
      contentContainerStyle={{ gap: 0, padding: 20, paddingTop: 0 }}
      refreshing={busy}
      onRefresh={() => void refresh()}
    >
      <View style={styles.mast}>
        <Image
          source={clementineArt}
          accessible={false}
          style={styles.art}
          resizeMode="cover"
        />
        <View style={styles.place}>
          <Ionicons name="location-outline" size={13} color={c.muted} />
          <Text style={styles.location}>
            {settings?.entity.city ?? "Mon magasin"}
          </Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          Journal
        </Text>
        <View style={styles.tabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: true }}
            style={[styles.tab, styles.activeTab]}
          >
            <Text style={styles.activeLabel}>Au quotidien</Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: false }}
            onPress={() =>
              router.push({ pathname: "/my-week", params: { weekStart } })
            }
            style={styles.tab}
          >
            <Text style={styles.tabLabel}>Ma semaine</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.dateHeading}>
        <Text accessibilityRole="header" style={styles.date}>
          {journalDateLabel(date)}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <JournalArrow
            label="Semaine précédente"
            icon="chevron-back"
            onPress={() => setDate(addContextDays(date, -7))}
          />
          <JournalArrow
            label="Semaine suivante"
            icon="chevron-forward"
            onPress={() => setDate(addContextDays(date, 7))}
          />
        </View>
      </View>
      <View style={styles.days}>
        {journalWeekDates(weekStart).map((d) => (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityLabel={`${journalDateLabel(d)}${d === today ? ", aujourd’hui" : ""}`}
            accessibilityState={{ selected: d === date }}
            onPress={() => setDate(d)}
            style={[styles.day, d === date && { backgroundColor: c.mint }]}
          >
            <Text style={[styles.weekday, d === date && styles.selectedText]}>
              {journalDateLabel(d, true).replace(".", "")}
            </Text>
            <Text style={[styles.dayNumber, d === date && styles.selectedText]}>
              {Number(d.slice(-2))}
            </Text>
            {d === today ? (
              <View
                style={[
                  styles.todayDot,
                  { backgroundColor: d === date ? c.canvas : c.mint },
                ]}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
      {date !== today ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setDate(today)}
          style={styles.today}
        >
          <Text style={styles.activeLabel}>Revenir à aujourd’hui</Text>
        </Pressable>
      ) : null}
      <View style={{ marginTop: 12, gap: 8 }}>
        <SecondaryButton
          label={busy ? "Actualisation…" : "Actualiser maintenant"}
          disabled={busy || settings?.syncState !== "SYNCED"}
          onPress={() => void refresh()}
        />
        <Text style={{ color: c.muted, fontSize: 12 }}>
          Enregistre un relevé du contexte maintenant, sans attendre la collecte
          automatique.
        </Text>
      </View>
      <View style={{ marginTop: 12 }}>
        <JournalWeather
          date={date}
          context={context}
          location={
            settings
              ? `${settings.entity.city} · ${settings.entity.postalCode}`
              : "Mon magasin"
          }
          configured={settings?.syncState === "SYNCED"}
          busy={busy}
          error={error}
          onRefresh={() => void refresh()}
          onSettings={() => router.push("/store-settings")}
        />
      </View>
      <JournalExternalContext
        date={date}
        context={context?.journal}
        busy={busy}
        configured={settings?.syncState === "SYNCED"}
        onRefresh={() => void refresh()}
      />
      <JournalTransports
        configuredLines={settings?.entity.transports?.lines}
        alertTypes={settings?.entity.transportAlertTypes}
        context={context?.journal}
        date={date}
        busy={busy}
        onRefresh={() => void refresh()}
      />
      <View style={styles.terrain}>
        <View style={styles.sectionHead}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Sur le terrain
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Signaler une observation produit"
            accessibilityState={{ disabled: date > today }}
            disabled={date > today}
            onPress={() =>
              router.push({ pathname: "/store-event", params: { date } })
            }
            className="active:opacity-70"
            style={[styles.report, { opacity: date > today ? 0.4 : 1 }]}
          >
            <Ionicons name="add" size={19} color={c.canvas} />
            <Text style={styles.reportLabel}>Signaler</Text>
          </Pressable>
        </View>
        <View style={{ borderTopWidth: 1, borderColor: c.line }}>
          {visible.length ? (
            visible.slice(0, 3).map((row) => (
              <Pressable
                key={row.entity.id}
                accessibilityRole="button"
                accessibilityLabel={`Consulter ${storeEventLabels[row.entity.type]} : ${row.label}`}
                onPress={() => setSelectedObservation(row)}
                className="active:opacity-70"
                style={[styles.entry, { opacity: 1 }]}
              >
                <Text style={styles.entryTime}>
                  {observationTime(row.entity.startedAt, date)}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.product}>{row.label}</Text>
                  <View style={styles.entryMeta}>
                    <SeverityBars value={row.entity.severity} />
                    <Text style={styles.meta}>
                      {storeEventLabels[row.entity.type]}
                      {row.entity.endedAt &&
                      parisDate(row.entity.endedAt) <= date
                        ? " · Terminé"
                        : ""}
                    </Text>
                    {row.syncState !== "SYNCED" ? (
                      <Text style={[styles.meta, { color: c.medium }]}>
                        {storeEventSyncState(row.syncState)}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.muted} />
              </Pressable>
            ))
          ) : (
            <Text style={styles.empty}>
              {date > today
                ? "Tu pourras signaler une observation à partir de cette date."
                : observations?.date === date
                  ? "Aucune observation pour cette journée."
                  : "Lecture des observations…"}
            </Text>
          )}
        </View>
        <JournalLink
          label={
            visible.length > 3
              ? "Voir toutes les observations"
              : "Historique des observations"
          }
          icon="time-outline"
          onPress={() => router.push("/store-events")}
        />
        <JournalNotes
          key={`${storeId}:${ownerId}:${date}`}
          storeId={storeId}
          date={date}
        />
        <JournalEconomy
          date={date}
          context={context?.economy}
          busy={busy}
          error={error}
          configured={settings?.syncState === "SYNCED"}
          onRefresh={() => void refresh()}
        />
        <JournalLink
          label={
            preparing
              ? "Préparation de la discussion…"
              : "Analyser cette journée"
          }
          icon="sparkles-outline"
          accent
          disabled={preparing}
          onPress={() => void analyze()}
        />
      </View>
      {localError ? <InlineAlert title="Journal" message={localError} /> : null}
      <BottomSheet
        visible={!!selectedObservation}
        title={selectedObservation?.label ?? "Observation"}
        swipeToClose
        onClose={() => setSelectedObservation(undefined)}
      >
        {selectedObservation ? (
          <>
            <Text className="text-ink">
              {storeEventLabels[selectedObservation.entity.type]} ·{" "}
              {selectedObservation.entity.status === "CLOSED"
                ? "Terminé"
                : selectedObservation.entity.status === "TO_REVIEW"
                  ? "À examiner"
                  : "En cours"}
            </Text>
            <View style={styles.entryMeta}>
              <SeverityBars value={selectedObservation.entity.severity} />
              <Text className="text-muted">
                Gravité{" "}
                {selectedObservation.entity.severity === null
                  ? "non précisée"
                  : { LOW: "faible", MEDIUM: "moyenne", HIGH: "élevée" }[
                      selectedObservation.entity.severity
                    ]}
              </Text>
            </View>
            <Text className="text-muted">
              Début :{" "}
              {storeEventTimeLabel(selectedObservation.entity.startedAt)}
            </Text>
            <Text className="text-muted">
              {selectedObservation.entity.endedAt
                ? `Fin : ${storeEventTimeLabel(selectedObservation.entity.endedAt)}`
                : "Fin non déclarée"}
            </Text>
            {selectedObservation.entity.comment ? (
              <Text className="text-ink">
                {selectedObservation.entity.comment}
              </Text>
            ) : null}
            <Text className="text-muted">
              Déclaration magasin ·{" "}
              {storeEventSyncState(selectedObservation.syncState)}
            </Text>
            <SecondaryButton
              label="Ouvrir le signalement et son historique"
              onPress={() => {
                const productId = selectedObservation.entity.productId;
                setSelectedObservation(undefined);
                router.push({
                  pathname: "/store-events",
                  params: { productId },
                });
              }}
            />
          </>
        ) : null}
      </BottomSheet>
    </AppScreen>
  );
}
function observationTime(instant: string, date: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    ...(parisDate(instant) === date
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short" }),
  }).format(new Date(instant));
}
function JournalArrow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: "chevron-back" | "chevron-forward";
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.arrow}
    >
      <Ionicons name={icon} size={21} color={c.muted} />
    </Pressable>
  );
}
function JournalLink({
  label,
  icon,
  onPress,
  accent = false,
  disabled = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress(): void;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="active:opacity-70"
      style={[
        styles.link,
        accent && { borderTopWidth: 1, borderColor: c.line },
        { opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={accent ? c.mint : c.muted} />
      <Text
        style={{
          flex: 1,
          color: accent ? c.mint : c.muted,
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
      <Ionicons
        name="arrow-forward"
        size={16}
        color={accent ? c.mint : c.muted}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  mast: { paddingTop: 17, overflow: "hidden" },
  art: {
    position: "absolute",
    right: -48,
    top: -24,
    width: 195,
    height: 145,
    transform: [{ rotate: "-9deg" }],
  },
  place: { flexDirection: "row", alignItems: "center", gap: 5 },
  location: { fontSize: 11, letterSpacing: 0.35, color: c.muted },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: c.ink,
    marginTop: 4,
    marginBottom: 19,
  },
  tabs: {
    flexDirection: "row",
    gap: 22,
    borderBottomWidth: 1,
    borderColor: c.line,
  },
  tab: {
    minHeight: 44,
    justifyContent: "center",
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  activeTab: { borderColor: c.mint },
  activeLabel: { color: c.mint, fontSize: 13, fontWeight: "600" },
  tabLabel: { color: c.muted, fontSize: 13, fontWeight: "600" },
  dateHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 3,
    paddingTop: 8,
  },
  date: {
    color: c.ink,
    fontSize: 16,
    fontWeight: "600",
    textTransform: "capitalize",
    flex: 1,
  },
  arrow: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  days: { flexDirection: "row", gap: 2 },
  day: {
    flex: 1,
    minWidth: 0,
    minHeight: 49,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 9,
    paddingVertical: 5,
  },
  weekday: {
    color: c.muted,
    fontSize: 10,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  dayNumber: {
    color: c.muted,
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  selectedText: { color: c.canvas },
  todayDot: {
    position: "absolute",
    bottom: 3,
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  today: { minHeight: 44, justifyContent: "center" },
  terrain: { marginTop: 18 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 7,
  },
  sectionTitle: { color: c.ink, fontSize: 18, fontWeight: "600" },
  report: {
    backgroundColor: c.mint,
    borderRadius: 99,
    paddingHorizontal: 14,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  reportLabel: { fontSize: 13, fontWeight: "700", color: c.canvas },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 66,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: c.line,
  },
  entryTime: {
    alignSelf: "flex-start",
    paddingTop: 2,
    width: 42,
    color: c.muted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  product: { color: c.ink, fontSize: 16, fontWeight: "600" },
  entryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 3,
  },
  meta: { color: c.muted, fontSize: 12 },
  empty: { color: c.muted, fontSize: 13, lineHeight: 20, paddingVertical: 12 },
  link: { flexDirection: "row", gap: 8, alignItems: "center", minHeight: 44 },
});
