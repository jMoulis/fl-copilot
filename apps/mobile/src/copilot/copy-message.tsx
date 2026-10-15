import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../design/tokens";

/** Keep readable Markdown tables, never copy private citation metadata. */
export function copyableAnswer(text: string): string {
  return text.replace(/\[([^\]]+)\]\(copilot-source:[^)]+\)/g, "$1");
}

export function CopyMessage({
  text,
  assistant,
}: {
  text: string;
  assistant: boolean;
}) {
  const [state, setState] = useState<"IDLE" | "COPYING" | "COPIED" | "ERROR">(
    "IDLE",
  );
  async function copy() {
    setState("COPYING");
    try {
      // Load only on request: older installed binaries keep rendering safely.
      const clipboard = await import("expo-clipboard");
      const success = await clipboard.setStringAsync(
        assistant ? copyableAnswer(text) : text,
      );
      setState(success ? "COPIED" : "ERROR");
    } catch {
      setState("ERROR");
    }
  }
  if (!text.trim()) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        assistant ? "Copier la réponse du copilote" : "Copier votre message"
      }
      accessibilityState={{
        disabled: state === "COPYING",
        busy: state === "COPYING",
      }}
      disabled={state === "COPYING"}
      onPress={() => {
        void copy();
      }}
      style={styles.button}
    >
      <Text accessibilityLiveRegion="polite" style={styles.label}>
        {state === "COPIED"
          ? "Copié ✓"
          : state === "ERROR"
            ? "Copie impossible · Réessayer"
            : state === "COPYING"
              ? "Copie…"
              : "Copier"}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
  },
  label: { color: colors.muted, fontSize: 13 },
});
