import { Text, View } from "react-native";
import { router } from "expo-router";
import { MainHeader } from "../../../components/main-header";
import { AppScreen, MenuRow, PrimaryButton } from "../../../components/ui";
import {
  formatFrenchCalendarDate,
  tradingToday,
} from "../../../dates/calendar";
/** Existing observations and weekly execution; contextual collection remains a later scope. */
export default function JournalScreen() {
  return (
    <AppScreen header={<MainHeader title="Journal" />}>
      <View className="gap-1">
        <Text className="text-muted">
          {formatFrenchCalendarDate(tradingToday())}
        </Text>
        <Text className="text-xl font-semibold text-ink">
          Le suivi de ton rayon
        </Text>
      </View>
      <PrimaryButton
        label="Signaler une observation"
        onPress={() => router.push("/store-event")}
      />
      <View className="rounded-3xl border border-line bg-surface px-4">
        <MenuRow
          title="Ma semaine"
          description="Tes TG, tes tâches et tes décisions commerciales"
          icon="calendar-outline"
          onPress={() => router.push("/my-week")}
        />
        <MenuRow
          title="Observations du rayon"
          description="Retrouver et suivre les signalements terrain"
          icon="chatbox-ellipses-outline"
          onPress={() => router.push("/store-events")}
        />
      </View>
    </AppScreen>
  );
}
