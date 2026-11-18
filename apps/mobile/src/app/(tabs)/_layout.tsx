import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, Tabs, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useWindowDimensions } from "react-native";
import { useAuth } from "../../auth/auth-provider";
import { colors } from "../../design/tokens";
export default function TabLayout() {
  const { status } = useAuth();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (status === "loading") return null;
  if (status !== "authenticated") return <Redirect href={"/login" as Href} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.navigationMuted,
        tabBarShowLabel: true,
        tabBarLabelPosition: "below-icon",
        tabBarIconStyle: { width: 44, height: 28 },
        tabBarStyle: {
          backgroundColor: colors.navigation,
          borderTopWidth: 0,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 10),
          height:
            58 + Math.max(insets.bottom, 10) + Math.max(0, fontScale - 1) * 32,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500", marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Journal",
          tabBarAccessibilityLabel: "Journal",
          tabBarIcon: ({ color }) => (
            <Ionicons name="journal-outline" color={color} size={23} />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: "Analyses",
          tabBarAccessibilityLabel: "Analyses",
          tabBarIcon: ({ color }) => (
            <Ionicons name="bar-chart-outline" color={color} size={23} />
          ),
        }}
      />
      <Tabs.Screen
        name="copilot"
        options={{
          title: "Copilote",
          tabBarAccessibilityLabel: "Copilote",
          tabBarIcon: ({ color }) => (
            <Ionicons name="sparkles-outline" color={color} size={23} />
          ),
        }}
      />
      <Tabs.Screen
        name="actions"
        options={{
          title: "Imports",
          tabBarAccessibilityLabel: "Imports",
          tabBarIcon: ({ color }) => (
            <Ionicons name="folder-outline" color={color} size={23} />
          ),
        }}
      />
      <Tabs.Screen name="products" options={{ href: null }} />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="week" options={{ href: null }} />
      <Tabs.Screen name="waste" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
      <Tabs.Screen name="commercial-review/[id]" options={{ href: null }} />
      <Tabs.Screen name="sync" options={{ href: null }} />
      <Tabs.Screen name="imports" options={{ href: null }} />
      <Tabs.Screen name="xlsx-diagnostic" options={{ href: null }} />
      <Tabs.Screen name="priority/[id]" options={{ href: null }} />
      <Tabs.Screen name="sync-conflict/[id]" options={{ href: null }} />
      <Tabs.Screen
        name="visual-recovery/[kind]/[id]"
        options={{ href: null }}
      />
      <Tabs.Screen name="import-verification/[id]" options={{ href: null }} />
    </Tabs>
  );
}
