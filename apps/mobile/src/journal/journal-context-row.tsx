import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { journalColors as c } from "./journal-theme";

export function JournalContextRow({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="active:opacity-70"
      style={{
        backgroundColor: c.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: c.line,
        padding: 16,
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
        minHeight: 76,
      }}
    >
      <Ionicons name={icon} size={24} color={c.mint} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: c.ink, fontWeight: "600", fontSize: 16 }}>
          {title}
        </Text>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.muted} />
    </Pressable>
  );
}
