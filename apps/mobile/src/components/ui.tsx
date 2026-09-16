import { useEffect, useRef, type PropsWithChildren } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  findNodeHandle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

export function AppScreen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-canvas">
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
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
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <View className="gap-4 rounded-3xl border border-line bg-white p-5">
      <Text
        accessibilityRole="header"
        className="text-lg font-semibold text-ink"
      >
        {title}
      </Text>
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
  local: ["Local", "phone-portrait-outline"],
  pending: ["À synchroniser", "time-outline"],
  syncing: ["Synchronisation…", "sync-outline"],
  synced: ["Synchronisé", "checkmark-circle-outline"],
  conflict: ["Conflit", "warning-outline"],
  offline: ["Hors connexion", "cloud-offline-outline"],
  error: ["Erreur de synchronisation", "alert-circle-outline"],
  aiPending: ["Analyse IA en attente", "hourglass-outline"],
  incomplete: ["Données incomplètes", "information-circle-outline"],
} as const;
export type SyncStatus = keyof typeof statusPresentation;
export function StatusBadge({ status }: { status: SyncStatus }) {
  const [label, icon] = statusPresentation[status];
  return (
    <View
      accessible
      accessibilityLabel={label}
      className="flex-row items-center gap-2 self-start rounded-xl bg-canvas px-3 py-2"
    >
      <Ionicons name={icon} size={18} color="#235C3D" accessible={false} />
      <Text className="flex-shrink text-sm font-medium text-ink">{label}</Text>
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
      accessibilityLabel={`${statusPresentation[status][0]}. Voir la synchronisation`}
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
        <ActivityIndicator color={secondary ? "#235C3D" : "#FFFFFF"} />
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
}: {
  title: string;
  message: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return (
    <View className="items-start gap-4 rounded-3xl border border-line bg-white p-6">
      <View className="rounded-2xl bg-canvas p-3">
        <Ionicons name={icon} size={30} color="#235C3D" accessible={false} />
      </View>
      <Text
        accessibilityRole="header"
        className="text-xl font-semibold text-ink"
      >
        {title}
      </Text>
      <Text className="text-base leading-7 text-muted">{message}</Text>
    </View>
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
          backgroundColor: "#00000066",
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
