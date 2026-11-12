import { useLocalSearchParams } from "expo-router";
import { contextWeekQuerySchema } from "@fl-copilot/domain";
import WeeklyPilotScreen from "@/commercial/weekly-pilot-screen";
export default function MyWeekRoute() {
  const { weekStart } = useLocalSearchParams<{ weekStart?: string }>();
  const parsed = contextWeekQuerySchema.safeParse({ weekStart });
  const initialWeek = parsed.success ? parsed.data.weekStart : undefined;
  return (
    <WeeklyPilotScreen key={initialWeek ?? "saved"} initialWeek={initialWeek} />
  );
}
