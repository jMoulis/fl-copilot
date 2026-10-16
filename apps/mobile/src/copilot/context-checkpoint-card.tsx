import { useState } from "react";
import { Text, View } from "react-native";
import { readContextCheckpoint, type CopilotMessage } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
/** Historical snapshot, not a claim that these notes are still current. */
export function ContextCheckpointCard({
  message,
}: {
  message: CopilotMessage;
}) {
  const { session } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const { content } = readContextCheckpoint(message);
  if (
    message.ownerId !== session?.user.id ||
    message.storeId !== session?.stores[0]?.storeId
  )
    return null;
  const labels = {
    GOAL: "Objectif",
    CONSTRAINT: "Contrainte",
    QUESTION: "Question",
    USER_CONTEXT: "Votre contexte",
    ASSISTANT_PROPOSAL: "Proposition du copilote",
  };
  return (
    <View style={{ gap: 10 }}>
      <SecondaryButton
        label={
          expanded ? "Fermer le contexte conservé" : "Voir le contexte conservé"
        }
        onPress={() => setExpanded((v) => !v)}
      />
      {expanded ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.muted }}>
            Sélection partielle conservée à cette étape. Les échanges originaux
            restent dans l’historique ; les chiffres actuels sont relus dans les
            données du magasin.
          </Text>
          {content.notes.map((n, index) => (
            <View key={`${n.sourceMessageId}/${index}`} style={{ gap: 4 }}>
              <Text style={{ color: colors.muted, fontWeight: "600" }}>
                {labels[n.topic]}
              </Text>
              <Text
                selectable
                style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}
              >
                {n.quote}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
