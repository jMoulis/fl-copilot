import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { currentCommercialWeek } from "@fl-copilot/commercial-core";
import { copilotBusinessDateSchema } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { AppScreen, InlineAlert, SecondaryButton } from "../components/ui";
import { SettingsHeader } from "../components/settings-chrome";
import { tradingToday } from "../dates/calendar";
import { useWeeklyContext } from "../store/use-weekly-context";
import { JournalContextRow } from "./journal-context-row";
import { JournalWeather } from "./journal-weather";
import { JournalTransports } from "./journal-transports";
import { JournalExternalContext } from "./journal-context";
import { JournalEconomy } from "./journal-economy";
import { JournalNationalNews } from "./journal-national-news";
import { journalDateLabel } from "./journal-presentation";
import { journalColors as c } from "./journal-theme";

export default function JournalContextScreen() {
  const { session } = useAuth();
  const { date: requestedDate } = useLocalSearchParams<{ date?: string }>();
  const parsed = copilotBusinessDateSchema.safeParse(requestedDate);
  const date = parsed.success ? parsed.data : tradingToday();
  const storeId = session?.stores[0]?.storeId;
  const header = (
    <SettingsHeader
      title="Repères du jour"
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace({ pathname: "/today", params: { date } });
      }}
    />
  );
  return storeId ? (
    <StoreContext
      key={`${session.user.id}:${storeId}:${date}`}
      storeId={storeId}
      date={date}
      header={header}
    />
  ) : (
    <AppScreen header={header}>
      <Text className="text-muted">
        Connecte-toi pour retrouver ton magasin.
      </Text>
    </AppScreen>
  );
}

function StoreContext({
  storeId,
  date,
  header,
}: {
  storeId: string;
  date: string;
  header: React.ReactNode;
}) {
  const weekStart = currentCommercialWeek(new Date(`${date}T12:00:00Z`)).start;
  const { settings, context, busy, error, collect } = useWeeklyContext(
    storeId,
    weekStart,
    true,
  );
  const configured = settings?.syncState === "SYNCED";
  const onRefresh = () => void collect();
  const shared = { date, busy, configured, onRefresh };
  const location = settings
    ? `${settings.entity.city} · ${settings.entity.postalCode}`
    : "Mon magasin";
  const weather = {
    ...shared,
    context,
    location,
    error,
    onSettings: () => router.push("/store-settings"),
  };
  return (
    <AppScreen
      header={header}
      backgroundColor={c.canvas}
      refreshing={busy}
      onRefresh={onRefresh}
      contentContainerStyle={{ padding: 20, gap: 12 }}
    >
      <View style={{ gap: 6, marginBottom: 8 }}>
        <Text style={{ color: c.muted, fontSize: 12 }}>{location}</Text>
        <Text
          accessibilityRole="header"
          style={{ color: c.ink, fontSize: 26, fontWeight: "600" }}
        >
          {journalDateLabel(date)}
        </Text>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 21 }}>
          Les informations utiles pour éclairer ta journée.
        </Text>
      </View>
      {error ? (
        <InlineAlert title="Repères à actualiser" message={error} />
      ) : null}
      <GroupTitle>Autour du magasin</GroupTitle>
      <JournalWeather
        {...weather}
        section="weather"
        renderTrigger={(open) => (
          <JournalContextRow
            title="Météo"
            subtitle="Prévisions et observations"
            icon="partly-sunny-outline"
            onPress={open}
          />
        )}
      />
      <JournalWeather
        {...weather}
        section="calendar"
        renderTrigger={(open) => (
          <JournalContextRow
            title="Calendrier"
            subtitle="Jours fériés et vacances scolaires"
            icon="calendar-outline"
            onPress={open}
          />
        )}
      />
      <JournalTransports
        {...shared}
        context={context?.journal}
        configuredLines={settings?.entity.transports?.lines}
        alertTypes={settings?.entity.transportAlertTypes}
        renderTrigger={(open) => (
          <JournalContextRow
            title="Transports"
            subtitle="Les lignes que tu suis"
            icon="train-outline"
            onPress={open}
          />
        )}
      />
      <JournalExternalContext
        {...shared}
        context={context?.journal}
        kinds={["WORKS", "AGENDA"]}
        renderTrigger={(kind, open) => (
          <JournalContextRow
            title={kind === "WORKS" ? "Travaux et accès" : "Événements locaux"}
            subtitle="Annonces de ta commune"
            icon={kind === "WORKS" ? "trail-sign-outline" : "location-outline"}
            onPress={open}
          />
        )}
      />
      <GroupTitle>Marché et actualités</GroupTitle>
      <JournalEconomy
        {...shared}
        context={context?.economy}
        error={error}
        renderTrigger={(open) => (
          <JournalContextRow
            title="Prix et conjoncture"
            subtitle="Indices INSEE et confiance des ménages"
            icon="stats-chart-outline"
            onPress={open}
          />
        )}
      />
      <JournalExternalContext
        {...shared}
        context={context?.journal}
        kinds={["CONSUMPTION"]}
        renderTrigger={(_, open) => (
          <JournalContextRow
            title="Achats de fruits et légumes"
            subtitle="Tendances nationales · FranceAgriMer"
            icon="basket-outline"
            onPress={open}
          />
        )}
      />
      <JournalNationalNews
        date={date}
        context={context?.journal}
        renderTrigger={(open) => (
          <JournalContextRow
            title="Actualités nationales"
            subtitle="Mouvements sociaux et restrictions"
            icon="newspaper-outline"
            onPress={open}
          />
        )}
      />
      <SecondaryButton
        label={busy ? "Actualisation…" : "Actualiser les repères"}
        disabled={busy || !configured}
        onPress={onRefresh}
      />
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
        Les dates, sources et archives sont disponibles dans chaque rubrique.
        Ces repères sont à croiser avec tes observations.
      </Text>
    </AppScreen>
  );
}
function GroupTitle({ children }: { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.6,
        marginTop: 12,
      }}
    >
      {children}
    </Text>
  );
}
