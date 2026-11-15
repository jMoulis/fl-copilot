import { Redirect, Tabs, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { View, useWindowDimensions } from "react-native";
import { useAuth } from "../../auth/auth-provider";
import { colors } from "../../design/tokens";
export default function TabLayout() {
  const { status } = useAuth();
  const { fontScale } = useWindowDimensions();
  if (status === "loading") return null;
  if (status !== "authenticated") return <Redirect href={"/login" as Href} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navigationInk,
        tabBarInactiveTintColor: colors.navigationMuted,
        tabBarShowLabel: true,
        tabBarLabelPosition: "below-icon",
        tabBarIconStyle: { width: 48, height: 30 },
        tabBarStyle: {
          backgroundColor: colors.navigation,
          borderTopWidth: 0,
          borderRadius: 24,
          marginHorizontal: 12,
          marginBottom: 10,
          paddingTop: 8,
          paddingBottom: 10,
          minHeight: 64 + Math.max(0, fontScale - 1) * 32,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Journal",
          tabBarAccessibilityLabel: "Journal",
          tabBarIcon: ({ color, size, focused }) => (
            <View
              style={{
                width: 48,
                height: 30,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: focused ? colors.accent : "transparent",
              }}
            >
              <Ionicons
                name={focused ? "journal" : "journal-outline"}
                color={focused ? colors.onAccent : color}
                size={Math.min(size, 22)}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: "Analyses",
          tabBarAccessibilityLabel: "Analyses",
          tabBarIcon: ({ color, size, focused }) => (
            <View
              style={{
                width: 48,
                height: 30,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: focused ? colors.accent : "transparent",
              }}
            >
              <Ionicons
                name={focused ? "bar-chart" : "bar-chart-outline"}
                color={focused ? colors.onAccent : color}
                size={Math.min(size, 22)}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="copilot"
        options={{
          title: "Copilote",
          tabBarAccessibilityLabel: "Copilote",
          tabBarIcon: ({ color, size, focused }) => (
            <View
              style={{
                width: 48,
                height: 30,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: focused ? colors.accent : "transparent",
              }}
            >
              <Ionicons
                name={focused ? "sparkles" : "sparkles-outline"}
                color={focused ? colors.onAccent : color}
                size={Math.min(size, 22)}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="actions"
        options={{
          title: "Imports",
          tabBarAccessibilityLabel: "Imports",
          tabBarIcon: ({ color, size, focused }) => (
            <View
              style={{
                width: 48,
                height: 30,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: focused ? colors.accent : "transparent",
              }}
            >
              <Ionicons
                name={focused ? "folder" : "folder-outline"}
                color={focused ? colors.onAccent : color}
                size={Math.min(size, 22)}
              />
            </View>
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
