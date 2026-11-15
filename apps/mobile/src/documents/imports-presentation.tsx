import { useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../design/tokens";

export function ImportDocumentRow({
  title,
  detail,
  date,
  format = "XLSX",
  accessibilityLabel = title,
  disabled,
  onPress,
  archiveAction,
  children,
}: {
  title: string;
  detail?: string;
  date?: string;
  format?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress(): void;
  archiveAction?: ReactNode;
  children?: ReactNode;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <View className="border-b border-line py-3">
      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          disabled={disabled}
          onPress={onPress}
          className="min-h-16 flex-1 flex-row items-center gap-3 py-2 active:opacity-70"
        >
          <View className="h-12 w-10 items-center justify-center gap-1 rounded-xl bg-forest-soft">
            <Ionicons
              name="document-text-outline"
              size={22}
              color={colors.forest}
              accessible={false}
            />
            <Text className="text-[9px] font-bold text-forest">{format}</Text>
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-semibold leading-5 text-ink">
              {title}
            </Text>
            {detail ? (
              <Text className="text-sm leading-5 text-muted">{detail}</Text>
            ) : null}
            {date ? (
              <Text className="text-xs leading-5 text-muted">
                Importé le {date}
              </Text>
            ) : null}
            {children}
          </View>
          <Ionicons
            name="chevron-forward"
            size={17}
            color={colors.muted}
            accessible={false}
          />
        </Pressable>
        {archiveAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Actions pour ${title}`}
            accessibilityState={{ expanded: actionsOpen, disabled }}
            disabled={disabled}
            onPress={() => setActionsOpen((value) => !value)}
            className="h-11 w-10 items-center justify-center rounded-xl active:bg-surface-muted"
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={20}
              color={colors.muted}
              accessible={false}
            />
          </Pressable>
        ) : null}
      </View>
      {actionsOpen ? <View className="mt-2 gap-2">{archiveAction}</View> : null}
    </View>
  );
}

export function ImportScreenHeader({
  title,
  subtitle,
  closeLabel,
  onClose,
  disabled = false,
  closeIcon = "close-outline",
  action,
}: {
  title: string;
  subtitle?: string;
  closeLabel?: string;
  onClose?(): void;
  disabled?: boolean;
  closeIcon?: ComponentProps<typeof Ionicons>["name"];
  action?: ReactNode;
}) {
  return (
    <View className="border-b border-line bg-canvas px-4 py-3">
      <View className="flex-row items-center gap-3">
        {onClose && closeIcon === "chevron-back" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            disabled={disabled}
            onPress={onClose}
            className="min-h-11 min-w-11 items-center justify-center rounded-full"
          >
            <Ionicons
              name={closeIcon}
              size={23}
              color={disabled ? colors.muted : colors.forest}
              accessible={false}
            />
          </Pressable>
        ) : null}
        <View className="min-w-0 flex-1 gap-1">
          <Text
            accessibilityRole="header"
            className="text-xl font-semibold leading-6 text-ink"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-sm leading-5 text-muted">{subtitle}</Text>
          ) : null}
        </View>
        {action}
        {onClose && closeIcon !== "chevron-back" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            disabled={disabled}
            onPress={onClose}
            className="h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-muted"
          >
            <Ionicons
              name={closeIcon}
              size={23}
              color={disabled ? colors.muted : colors.ink}
              accessible={false}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
