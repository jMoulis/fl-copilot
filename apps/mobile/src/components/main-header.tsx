import brandMark from "../../assets/journal/marque.png";
import { Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../design/tokens";

/** Fixed shortcuts on main screens; detail pages keep their own Back action. */
export function MainHeader({
  title,
  brand = false,
}: {
  title: string;
  brand?: boolean;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: brand ? 2 : 16,
        gap: 12,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 1,
        borderColor: colors.line,
      }}
    >
      {brand ? (
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Image
            source={brandMark}
            style={{ width: 24, height: 26 }}
            accessible={false}
          />
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>
            Fleg{" "}
            <Text style={{ color: colors.muted, fontWeight: "400" }}>
              Copilot
            </Text>
          </Text>
        </View>
      ) : (
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            color: colors.ink,
            fontSize: 28,
            fontWeight: "700",
          }}
        >
          {title}
        </Text>
      )}
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
      className="active:opacity-70"
      style={{
        minWidth: 48,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons
        name={icon}
        color={colors.forest}
        size={22}
        accessible={false}
      />
    </Pressable>
  );
}
