import { useEffect, useRef, type PropsWithChildren } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  findNodeHandle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "@/design/tokens";

export function AppScreen({
  children,
  refreshing = false,
  onRefresh,
}: PropsWithChildren<{
  refreshing?: boolean;
  onRefresh?: () => void;
}>) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-canvas">
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.forest}
              colors={[colors.forest]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function AppHeader({
  title,
  subtitle,
  children,
}: PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase tracking-widest text-forest">
        Fruits & légumes
      </Text>
      <Text accessibilityRole="header" className="text-3xl font-bold text-ink">
        {title}
      </Text>
      {subtitle ? (
        <Text className="text-base leading-6 text-muted">{subtitle}</Text>
      ) : null}
      {children}
    </View>
  );
}
export function SectionCard({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) {
  return (
    <View className="gap-4 rounded-3xl border border-line bg-white p-5">
      <Text
        accessibilityRole="header"
        className="text-lg font-semibold text-ink"
      >
        {title}
      </Text>
      {description ? (
        <Text className="-mt-2 text-sm leading-5 text-muted">
          {description}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | null;
  detail?: string;
}) {
  return (
    <View className="gap-2 rounded-2xl border border-line bg-white p-5">
      <Text className="text-base text-muted">{label}</Text>
      <Text className="text-3xl font-bold text-ink">
        {value ?? "Indisponible"}
      </Text>
      {detail ? (
        <Text className="text-sm leading-5 text-muted">{detail}</Text>
      ) : null}
    </View>
  );
}
const statusPresentation = {
  local: {
    label: "Local",
    icon: "phone-portrait-outline",
    containerClass: "bg-info-soft",
    textClass: "text-info",
    iconColor: colors.info,
  },
  pending: {
    label: "À synchroniser",
    icon: "time-outline",
    containerClass: "bg-pending-soft",
    textClass: "text-pending",
    iconColor: colors.pending,
  },
  syncing: {
    label: "Synchronisation…",
    icon: "sync-outline",
    containerClass: "bg-info-soft",
    textClass: "text-info",
    iconColor: colors.info,
  },
  synced: {
    label: "Synchronisé",
    icon: "checkmark-circle-outline",
    containerClass: "bg-positive-soft",
    textClass: "text-positive",
    iconColor: colors.positive,
  },
  conflict: {
    label: "Conflit",
    icon: "warning-outline",
    containerClass: "bg-warning-soft",
    textClass: "text-warning",
    iconColor: colors.warning,
  },
  offline: {
    label: "Hors connexion",
    icon: "cloud-offline-outline",
    containerClass: "bg-surface-muted",
    textClass: "text-ink",
    iconColor: colors.ink,
  },
  error: {
    label: "Erreur",
    icon: "alert-circle-outline",
    containerClass: "bg-critical-soft",
    textClass: "text-critical",
    iconColor: colors.critical,
  },
  aiPending: {
    label: "Analyse IA en attente",
    icon: "hourglass-outline",
    containerClass: "bg-pending-soft",
    textClass: "text-pending",
    iconColor: colors.pending,
  },
  incomplete: {
    label: "Données incomplètes",
    icon: "information-circle-outline",
    containerClass: "bg-warning-soft",
    textClass: "text-warning",
    iconColor: colors.warning,
  },
  stale: {
    label: "Données anciennes",
    icon: "calendar-outline",
    containerClass: "bg-warning-soft",
    textClass: "text-warning",
    iconColor: colors.warning,
  },
} as const;
export type SyncStatus = keyof typeof statusPresentation;
export function StatusBadge({ status }: { status: SyncStatus }) {
  const presentation = statusPresentation[status];
  return (
    <View
      accessible
      accessibilityLabel={presentation.label}
      className={`flex-row items-center gap-2 self-start rounded-xl px-3 py-2 ${presentation.containerClass}`}
    >
      <Ionicons
        name={presentation.icon}
        size={18}
        color={presentation.iconColor}
        accessible={false}
      />
      <Text
        className={`flex-shrink text-sm font-semibold ${presentation.textClass}`}
      >
        {presentation.label}
      </Text>
    </View>
  );
}
export function SyncState({
  status,
  onPress,
}: {
  status: SyncStatus;
  onPress?: () => void;
}) {
  if (!onPress) return <StatusBadge status={status} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${statusPresentation[status].label}. Voir la synchronisation`}
      onPress={onPress}
      style={{ minHeight: 48, justifyContent: "center" }}
    >
      <StatusBadge status={status} />
    </Pressable>
  );
}
type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};
function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  secondary = false,
}: ButtonProps & { secondary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => ({
        minHeight: 48,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
      className={`flex-row items-center justify-center gap-2 rounded-2xl border px-5 py-3 ${secondary ? "border-forest bg-white" : "border-forest bg-forest"}`}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? colors.forest : colors.surface} />
      ) : null}
      <Text
        className={`flex-shrink text-center text-base font-semibold ${secondary ? "text-forest" : "text-white"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} />;
}
export function SecondaryButton(props: ButtonProps) {
  return <Button {...props} secondary />;
}
export function InlineAlert({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      className="gap-2 rounded-2xl border border-line bg-white p-4"
    >
      <Text className="text-base font-semibold text-ink">ⓘ {title}</Text>
      <Text className="text-base leading-6 text-muted">{message}</Text>
    </View>
  );
}
export function EmptyState({
  title,
  message,
  icon = "leaf-outline",
  children,
}: PropsWithChildren<{
  title: string;
  message: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}>) {
  return (
    <View className="items-start gap-4 rounded-3xl border border-line bg-white p-6">
      <View className="rounded-2xl bg-canvas p-3">
        <Ionicons
          name={icon}
          size={30}
          color={colors.forest}
          accessible={false}
        />
      </View>
      <Text
        accessibilityRole="header"
        className="text-xl font-semibold text-ink"
      >
        {title}
      </Text>
      <Text className="text-base leading-7 text-muted">{message}</Text>
      {children ? <View className="w-full gap-3">{children}</View> : null}
    </View>
  );
}

export function MenuRow({
  title,
  description,
  icon,
  onPress,
}: {
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      className="flex-row items-center gap-4 rounded-2xl bg-surface-muted px-4 py-4"
      style={({ pressed }) => ({
        minHeight: 64,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View className="rounded-xl bg-forest-soft p-2.5">
        <Ionicons
          name={icon}
          size={22}
          color={colors.forest}
          accessible={false}
        />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-ink">{title}</Text>
        <Text className="text-sm leading-5 text-muted">{description}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.muted}
        accessible={false}
      />
    </Pressable>
  );
}
/** Native modal wrapper; content scrolls at large text sizes. */
export function BottomSheet({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
}>) {
  const heading = useRef<Text>(null);
  useEffect(() => {
    if (!visible || Platform.OS === "web") return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(heading.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 250);
    return () => clearTimeout(timer);
  }, [visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: colors.overlay,
        }}
      >
        <SafeAreaView
          edges={["bottom", "left", "right"]}
          accessibilityViewIsModal
          className="rounded-t-3xl bg-white"
          style={{ maxHeight: "90%" }}
        >
          <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
            <Text
              ref={heading}
              accessible
              accessibilityRole="header"
              className="text-2xl font-bold text-ink"
            >
              {title}
            </Text>
            {children}
            <SecondaryButton label="Fermer" onPress={onClose} />
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
