import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { StoreProductEvent } from "@fl-copilot/domain";
import { journalColors as c } from "../journal/journal-theme";

type Severity = StoreProductEvent["severity"];
const levels = [
  {
    value: "LOW",
    label: "Faible",
    color: c.low,
    background: "#2E4130",
    count: 1,
  },
  {
    value: "MEDIUM",
    label: "Moyenne",
    color: c.medium,
    background: "#39402A",
    count: 2,
  },
  {
    value: "HIGH",
    label: "Élevée",
    color: c.high,
    background: "#393B30",
    count: 3,
  },
] as const;

export function SeverityBars({
  value,
  large = false,
}: {
  value: Severity;
  large?: boolean;
}) {
  const level = levels.find((item) => item.value === value);
  if (!level) return null;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Gravité ${level.label.toLocaleLowerCase("fr")}`}
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: large ? 3 : 2,
        height: large ? 18 : 11,
      }}
    >
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: large ? 5 : 3,
            height: n * (large ? 5 : 3) + 2,
            borderRadius: 1.5,
            backgroundColor: n <= level.count ? level.color : c.line,
          }}
        />
      ))}
    </View>
  );
}

export function EventSeverity({
  value,
  onChange,
  disabled,
}: {
  value: Severity;
  onChange(value: Severity): void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.heading}>
        <Text style={styles.title}>Niveau de gravité</Text>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: value === null, disabled }}
          accessibilityLabel="Gravité non précisée"
          disabled={disabled}
          onPress={() => onChange(null)}
          style={styles.none}
        >
          <Ionicons
            name={
              value === null
                ? "radio-button-on-outline"
                : "radio-button-off-outline"
            }
            size={14}
            color={c.muted}
          />
          <Text style={{ color: c.muted, fontSize: 12 }}>Non précisée</Text>
        </Pressable>
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Gravité du signalement"
        style={{ flexDirection: "row", gap: 6 }}
      >
        {levels.map((level) => (
          <Pressable
            key={level.value}
            accessibilityRole="radio"
            accessibilityLabel={`Gravité ${level.label.toLocaleLowerCase("fr")}`}
            accessibilityState={{ checked: value === level.value, disabled }}
            disabled={disabled}
            onPress={() => onChange(level.value)}
            className="active:opacity-70"
            style={[
              styles.option,
              {
                borderColor: value === level.value ? level.color : c.line,
                backgroundColor:
                  value === level.value ? level.background : c.surface,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <View style={styles.heading}>
              <SeverityBars value={level.value} large />
              {value === level.value ? (
                <Ionicons
                  name="checkmark-circle"
                  size={17}
                  color={level.color}
                />
              ) : null}
            </View>
            <Text style={styles.label}>{level.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { color: c.ink, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  none: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 },
  option: {
    flex: 1,
    minWidth: 0,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    justifyContent: "space-between",
    gap: 10,
  },
  label: { color: c.ink, fontSize: 14, fontWeight: "600" },
});
