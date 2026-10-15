import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  StyleSheet,
} from "react-native";
import type { CopilotActivity } from "@fl-copilot/sync-contracts";
import { colors } from "../design/tokens";
const labels: Record<CopilotActivity["stage"], string> = {
  PREPARING: "Préparation de la réponse",
  ANALYTICS: "Consultation des chiffres",
  COMPARISON: "Comparaison des périodes",
  PRODUCTS: "Recherche des produits concernés",
  DOCUMENTS: "Consultation des documents",
  CONTEXT: "Consultation du contexte du magasin",
  INFORMATION: "Préparation d’une demande de précision",
  PROPOSAL: "Préparation d’une proposition",
  WRITING: "Rédaction de la réponse",
};
export function CopilotActivityTrail({
  activities,
}: {
  activities: readonly CopilotActivity[];
}) {
  const [expanded, setExpanded] = useState(false);
  const active = [...activities].reverse().find((a) => a.status === "RUNNING");
  const label = active
    ? labels[active.stage]
    : activities.some((a) => a.stage === "WRITING")
      ? "Finalisation de la réponse"
      : "Préparation de la réponse";
  return (
    <View style={styles.trail}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${expanded ? "Masquer" : "Afficher"} les étapes`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={styles.toggle}
      >
        <ActivityIndicator size="small" color={colors.muted} />
        <Text accessibilityLiveRegion="polite" style={styles.current}>
          {label}…
        </Text>
        <Text style={styles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>
      {expanded
        ? activities.map((a) => (
            <View key={a.id} style={styles.step}>
              <Text style={styles.icon}>
                {a.status === "DONE"
                  ? "✓"
                  : a.status === "UNAVAILABLE"
                    ? "–"
                    : "•"}
              </Text>
              <Text style={styles.detail}>
                {labels[a.stage]}
                {a.status === "UNAVAILABLE" ? " — indisponible" : ""}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}
const styles = StyleSheet.create({
  trail: { gap: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  current: { fontSize: 14, lineHeight: 21, color: colors.muted, flex: 1 },
  chevron: { color: colors.muted, fontSize: 20 },
  step: { flexDirection: "row", gap: 8, paddingLeft: 2, paddingVertical: 3 },
  icon: { width: 18, color: colors.forest },
  detail: { fontSize: 13, lineHeight: 20, color: colors.muted, flex: 1 },
});
