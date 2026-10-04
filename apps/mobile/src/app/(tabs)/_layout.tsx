import { Redirect, Tabs, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useWindowDimensions } from "react-native";
import { useAuth } from "@/auth/auth-provider";
import { colors } from "@/design/tokens";
export default function TabLayout() {
  const { status } = useAuth();
  const { fontScale } = useWindowDimensions();
  if (status === "loading") return null;
  if (status !== "authenticated") return <Redirect href={"/login" as Href} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.muted,
        tabBarShowLabel: true,
        tabBarLabelPosition: "below-icon",
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          minHeight: 64 + Math.max(0, fontScale - 1) * 32,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Aujourd’hui",
          tabBarAccessibilityLabel: "Aujourd’hui",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: "Ma semaine",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "calendar" : "calendar-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: "Analyses",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "bar-chart" : "bar-chart-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="waste"
        options={{
          title: "Casse",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "camera" : "camera-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "Plus",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "menu" : "menu-outline"}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen name="sync" options={{ href: null }} />
      <Tabs.Screen name="imports" options={{ href: null }} />
      <Tabs.Screen name="xlsx-diagnostic" options={{ href: null }} />
      <Tabs.Screen name="products/index" options={{ href: null }} />
      <Tabs.Screen name="products/[id]" options={{ href: null }} />
      <Tabs.Screen name="sync-conflict/[id]" options={{ href: null }} />
      <Tabs.Screen name="import-verification/[id]" options={{ href: null }} />
    </Tabs>
  );
}
