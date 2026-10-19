import { Stack } from "expo-router";
import { colors } from "@/design/tokens";
export default function DomainStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
        gestureEnabled: true,
      }}
    />
  );
}
