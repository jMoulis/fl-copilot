import { useState } from "react";
import { Text, View } from "react-native";
import type { StoreLayoutContent } from "@fl-copilot/domain";
import { layoutChanges } from "@fl-copilot/commercial-core";
import { SecondaryButton } from "../components/ui";
export function LayoutComparison({
  before,
  after,
}: {
  before: StoreLayoutContent | null;
  after: StoreLayoutContent;
}) {
  const changes = layoutChanges(before, after),
    [expanded, setExpanded] = useState(false),
    shown = expanded ? changes : changes.slice(0, 12);
  return (
    <View style={{ gap: 14 }}>
      <Text className="text-base text-ink">
        {changes.length
          ? `${changes.length} modification${changes.length > 1 ? "s" : ""}`
          : "Aucune différence de contenu"}
      </Text>
      {shown.map((c) => (
        <View key={c.key} className="gap-1 rounded-xl bg-canvas p-3">
          <Text className="font-semibold text-ink">{c.label}</Text>
          <Text className="text-muted">Avant : {c.before}</Text>
          <Text className="text-ink">Après : {c.after}</Text>
        </View>
      ))}
      {!expanded && changes.length > 12 ? (
        <SecondaryButton
          label={`Afficher les ${changes.length - 12} autres modifications`}
          onPress={() => setExpanded(true)}
        />
      ) : null}
    </View>
  );
}
