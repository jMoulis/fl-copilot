import { useState, type PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../design/tokens";

type Icon = React.ComponentProps<typeof Ionicons>["name"];
export function IconButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: Icon;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface"
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={21} color={colors.ink} accessible={false} />
    </Pressable>
  );
}
/** The entire control remains a 48pt target while its selected pill is compact. */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: K; label: string }[];
  value: string;
  onChange(value: K): void;
  label: string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row flex-wrap rounded-2xl bg-surface p-1"
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          aria-checked={value === option.value}
          accessibilityLabel={`${label} : ${option.label}`}
          accessibilityState={{ checked: value === option.value }}
          onPress={() => onChange(option.value)}
          className="min-h-12 flex-1 justify-center px-1 py-1"
        >
          <View
            className={`min-h-8 items-center justify-center rounded-full px-2 py-1.5 ${value === option.value ? "bg-forest" : "bg-surface"}`}
          >
            <Text
              className={`text-center text-sm font-semibold ${value === option.value ? "text-on-accent" : "text-muted"}`}
            >
              {option.label}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
export function DetailsDisclosure({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        aria-expanded={open}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        className="min-h-12 flex-row items-center justify-between gap-3"
      >
        <View className="flex-1 flex-row items-center gap-2">
          <Ionicons
            name="information-circle-outline"
            size={17}
            color={colors.muted}
            accessible={false}
          />
          <Text className="flex-1 text-sm text-muted">{title}</Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={17}
          color={colors.muted}
          accessible={false}
        />
      </Pressable>
      {open ? <View className="gap-3 pb-2">{children}</View> : null}
    </View>
  );
}
export function DashboardMetric({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: string | null;
  detail?: string;
  icon: Icon;
  tone?: "neutral" | "positive" | "critical";
  compact?: boolean;
}) {
  const color =
    tone === "positive"
      ? colors.positive
      : tone === "critical"
        ? colors.critical
        : colors.muted;
  return (
    <View
      className={`rounded-2xl border border-line bg-surface ${compact ? "flex-1 gap-2 p-3" : "gap-3 p-4"}`}
    >
      <View
        className="flex-row items-center gap-2"
        style={compact ? { minHeight: 32 } : undefined}
      >
        <View
          className={`${compact ? "h-6 w-6" : "h-8 w-8"} items-center justify-center rounded-xl bg-forest-soft`}
        >
          <Ionicons
            name={icon}
            size={compact ? 14 : 17}
            color={colors.forest}
            accessible={false}
          />
        </View>
        <Text
          className={`flex-1 ${compact ? "text-xs" : "text-sm"} text-muted`}
        >
          {label}
        </Text>
      </View>
      <Text
        className="text-2xl font-bold text-ink"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value ?? "Indisponible"}
      </Text>
      {detail ? (
        <Text style={{ color, fontSize: 12, lineHeight: 18 }}>{detail}</Text>
      ) : null}
    </View>
  );
}
