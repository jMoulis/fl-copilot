import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { randomUUID } from "expo-crypto";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import {
  addContextDays,
  storeEventLabels,
  storeEventTimeLabel,
} from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { useWeeklyContext } from "../store/use-weekly-context";
import {
  AppScreen,
  InlineAlert,
  MenuRow,
  PrimaryButton,
  SecondaryButton,
} from "../components/ui";
import { MainHeader } from "../components/main-header";
import { IconButton, SegmentedControl } from "../components/dashboard";
import { tradingToday } from "../dates/calendar";
import { colors } from "../design/tokens";
import { storeEventSyncState } from "../needs/store-event-presentation";
import { JournalWeather } from "./journal-weather";
import { journalDateLabel } from "./journal-presentation";
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
  const { settings, context, busy, error, refresh } = useWeeklyContext(
    storeId,
    weekStart,
    true,
  );
  const [observations, setObservations] = useState<{
    date: string;
    rows: Awaited<ReturnType<typeof journalObservations>>;
  }>();
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
        `Fais le point sur la journée du ${date} pour mon rayon. Consulte les chiffres disponibles, les observations terrain et le contexte météo/calendrier de cette date si disponible. Compare des jours de semaine équivalents et distingue les faits des explications possibles. Une prévision archivée n’est pas une météo observée. Ne modifie rien.`,
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
      header={<MainHeader title="Journal" />}
      refreshing={busy}
      onRefresh={() => void refresh()}
    >
      <Text className="text-muted">
        {settings?.entity.city ?? "Le suivi de ton rayon"}
      </Text>
      <SegmentedControl
        label="Parcours du journal"
        value="day"
        options={[
          { value: "day", label: "Au quotidien" },
          { value: "week", label: "Ma semaine" },
        ]}
        onChange={(v) => {
          if (v === "week")
            router.push({ pathname: "/my-week", params: { weekStart } });
        }}
      />
      <View className="flex-row items-center justify-between gap-2">
        <IconButton
          label="Semaine précédente"
          icon="chevron-back"
          onPress={() => setDate(addContextDays(date, -7))}
        />
        <View className="flex-1 items-center gap-1">
          <Text className="text-center text-base font-semibold text-ink">
            {journalDateLabel(date)}
          </Text>
          {date === today ? (
            <Text className="text-xs text-forest">Aujourd’hui</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDate(today)}
              style={{ minHeight: 32, justifyContent: "center" }}
            >
              <Text className="text-xs text-forest">Revenir à aujourd’hui</Text>
            </Pressable>
          )}
        </View>
        <IconButton
          label="Semaine suivante"
          icon="chevron-forward"
          onPress={() => setDate(addContextDays(date, 7))}
        />
      </View>
      <JournalWeather
        date={date}
        weekStart={weekStart}
        context={context}
        location={
          settings
            ? `${settings.entity.city} · ${settings.entity.postalCode}`
            : "Mon magasin"
        }
        configured={settings?.syncState === "SYNCED"}
        busy={busy}
        onSelectDate={setDate}
        onRefresh={() => void refresh()}
        onSettings={() => router.push("/store-settings")}
      />
      {error ? (
        <InlineAlert title="Contexte à actualiser" message={error} />
      ) : null}
      <PrimaryButton
        label="Noter une observation produit"
        disabled={date > today}
        onPress={() =>
          router.push({ pathname: "/store-event", params: { date } })
        }
      />
      {date > today ? (
        <Text className="text-sm text-muted">
          Les observations décrivent des faits déjà survenus. Pour les actions à
          venir, ouvre Ma semaine.
        </Text>
      ) : null}
      {visible.length ? (
        <View className="gap-3">
          <Text
            accessibilityRole="header"
            className="text-lg font-semibold text-ink"
          >
            Sur le terrain
          </Text>
          {visible.slice(0, 3).map((row) => (
            <Pressable
              key={row.entity.id}
              accessibilityRole="button"
              accessibilityLabel={`Consulter ${storeEventLabels[row.entity.type]} : ${row.label}`}
              onPress={() =>
                router.push({
                  pathname: "/store-events",
                  params: { productId: row.entity.productId },
                })
              }
              style={({ pressed }) => ({
                backgroundColor: colors.surface,
                borderRadius: 18,
                padding: 16,
                gap: 8,
                borderWidth: 1,
                borderColor: colors.line,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-xs font-semibold uppercase text-forest">
                  {storeEventLabels[row.entity.type]}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.muted}
                />
              </View>
              <Text className="font-semibold text-ink">{row.label}</Text>
              {row.entity.comment ? (
                <Text className="text-sm leading-5 text-ink">
                  {row.entity.comment}
                </Text>
              ) : null}
              <Text className="text-xs text-muted">
                Début : {storeEventTimeLabel(row.entity.startedAt)}
                {row.entity.endedAt
                  ? ` · fin : ${storeEventTimeLabel(row.entity.endedAt)}`
                  : " · fin non déclarée"}
              </Text>
              <Text className="text-xs text-muted">
                Déclaration magasin · {storeEventSyncState(row.syncState)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="border-t border-line">
        <MenuRow
          title={
            visible.length > 3
              ? "Voir toutes les observations"
              : "Historique des observations"
          }
          description="Signalements, clôtures et synchronisation"
          icon="chatbox-ellipses-outline"
          onPress={() => router.push("/store-events")}
        />
        <MenuRow
          title="Ma semaine"
          description="Tes TG, tes tâches et tes décisions commerciales"
          icon="calendar-outline"
          onPress={() =>
            router.push({ pathname: "/my-week", params: { weekStart } })
          }
        />
      </View>
      <SecondaryButton
        label={
          preparing
            ? "Préparation de la discussion…"
            : "Analyser cette journée avec le copilote"
        }
        disabled={preparing}
        onPress={() => void analyze()}
      />
      {localError ? <InlineAlert title="Journal" message={localError} /> : null}
    </AppScreen>
  );
}
