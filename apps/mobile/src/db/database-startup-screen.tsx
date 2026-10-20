import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../design/tokens";

export type DatabaseStartupScreenProps = {
  state: "unavailable" | "corruption" | "confirm" | "recovering" | "recovered";
  onRetry(): void;
  onPrepare(): void;
  onCancel(): void;
  onRecover(): void;
  onContinue(): void;
};

export function DatabaseStartupScreen(props: DatabaseStartupScreenProps) {
  const insets = useSafeAreaInsets(),
    busy = props.state === "recovering";
  const confirming = props.state === "confirm" || busy;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(24, insets.top),
          paddingBottom: Math.max(24, insets.bottom),
        },
      ]}
    >
      <Text style={styles.title}>
        {props.state === "recovered"
          ? "Nouvelle base locale préparée"
          : "Base locale indisponible"}
      </Text>
      <Text style={styles.message} accessibilityLiveRegion="polite">
        {props.state === "recovered"
          ? "L’ancienne copie et les fichiers sont conservés sur cet appareil. Reconnectez-vous pour retrouver les données déjà synchronisées."
          : props.state === "unavailable"
            ? "Les données locales ne peuvent pas être ouvertes. Réessayez sans supprimer l’application."
            : "La base locale est endommagée. Vos fichiers restent conservés sur cet appareil."}
      </Text>
      {busy ? <ActivityIndicator size="large" color={colors.forest} /> : null}
      {confirming || props.state === "recovered" ? (
        <View style={styles.explanation}>
          {confirming ? (
            <Text style={styles.message}>
              Une base neuve sera préparée. L’ancienne copie et les fichiers
              resteront sur cet appareil. Vous devrez vous reconnecter pour
              retrouver les données déjà synchronisées.
            </Text>
          ) : null}
          <Text style={styles.message}>
            Les modifications non envoyées ne seront pas réappliquées
            automatiquement : elles resteront dans l’ancienne copie, à examiner.
            Ne supprimez pas l’application.
          </Text>
        </View>
      ) : null}
      {props.state === "recovered" ? (
        <Button
          label="Continuer vers la connexion"
          onPress={props.onContinue}
        />
      ) : confirming ? (
        <>
          <Button
            label={
              busy
                ? "Préparation de la reprise…"
                : "Conserver la copie et reprendre"
            }
            disabled={busy}
            onPress={props.onRecover}
          />
          <Button
            label="Annuler"
            secondary
            disabled={busy}
            onPress={props.onCancel}
          />
        </>
      ) : (
        <>
          <Button label="Réessayer" onPress={props.onRetry} />
          {props.state === "corruption" ? (
            <Button
              label="Préparer une reprise sécurisée"
              secondary
              onPress={props.onPrepare}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function Button({
  label,
  secondary = false,
  disabled = false,
  onPress,
}: {
  label: string;
  secondary?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary ? styles.secondary : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[styles.buttonLabel, secondary ? styles.secondaryLabel : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas, flex: 1 },
  content: {
    alignItems: "center",
    flexGrow: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  explanation: { gap: 16, maxWidth: 560 },
  button: {
    backgroundColor: colors.forest,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: colors.onAccent,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  secondary: {
    backgroundColor: "transparent",
    borderColor: colors.line,
    borderWidth: 1,
  },
  secondaryLabel: { color: colors.ink },
  disabled: { opacity: 0.65 },
});
