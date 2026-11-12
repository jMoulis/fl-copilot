import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../design/tokens";

/** Fixed shortcuts on main screens; detail pages keep their own Back action. */
export function MainHeader({ title }: { title: string }) {
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ flex: 1, color: colors.ink, fontSize: 28, fontWeight: "700" }}
      >
        {title}
      </Text>
      <Shortcut
        label="Produits"
        icon="nutrition-outline"
        onPress={() => router.push("/catalogue")}
      />
      <Shortcut
        label="Réglages"
        icon="settings-outline"
        onPress={() => router.push("/settings")}
      />
    </View>
  );
}
function Shortcut({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir ${label.toLocaleLowerCase("fr")}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 48,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={icon}
        color={colors.forest}
        size={22}
        accessible={false}
      />
      <Text style={{ color: colors.ink, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
