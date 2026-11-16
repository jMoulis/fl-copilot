import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { IconButton } from "./dashboard";
import { colors } from "../design/tokens";

/** Secondary screens keep one fixed Back target above their scrolling content. */
export function SettingsHeader({
  title,
  onBack,
}: {
  title: string;
  onBack(): void;
}) {
  return (
    <View className="flex-row items-center gap-3 border-b border-line px-4 py-2">
      <IconButton label="Retour" icon="chevron-back" onPress={onBack} />
      <Text
        accessibilityRole="header"
        className="flex-1 text-base font-semibold text-ink"
      >
        {title}
      </Text>
      <Ionicons
        name="leaf-outline"
        size={22}
        color={colors.forest}
        accessible={false}
      />
    </View>
  );
}

export function SettingsIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <View className="gap-2 pt-2">
      <Text className="text-xs font-bold uppercase tracking-widest text-forest">
        {eyebrow}
      </Text>
      <Text
        accessibilityRole="header"
        className="text-4xl font-semibold tracking-tight text-ink"
      >
        {title}
      </Text>
      <Text className="text-sm leading-6 text-muted">{description}</Text>
    </View>
  );
}

export function SettingsGroup({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <View className="gap-1">
      <Text
        accessibilityRole="header"
        className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted"
      >
        {title}
      </Text>
      {children}
    </View>
  );
}
