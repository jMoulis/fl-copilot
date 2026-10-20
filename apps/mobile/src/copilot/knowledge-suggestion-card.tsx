import { useCallback, useState } from "react";
import { ChatText as Text } from "./chat-text";
import { router, useFocusEffect } from "expo-router";
import {
  readKnowledgeSuggestion,
  copilotKnowledgeSchema,
  type CopilotKnowledge,
  type CopilotMessage,
} from "@fl-copilot/domain";
import { SectionCard, SecondaryButton } from "../components/ui";
import { colors } from "../design/tokens";
import { useLocalDatabase } from "../providers/database-provider";
import { useAuth } from "../auth/auth-provider";
export function KnowledgeSuggestionCard({
  message,
}: {
  message: CopilotMessage;
}) {
  const { content } = readKnowledgeSuggestion(message),
    { sqlite } = useLocalDatabase(),
    { session } = useAuth();
  const ownerId = session?.user.id,
    storeId = session?.stores[0]?.storeId;
  const [saved, setSaved] = useState<{
      entity: CopilotKnowledge;
      syncState: string;
    } | null>(),
    [failed, setFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void sqlite
        .getFirstAsync<{ payload_json: string; sync_state: string }>(
          "SELECT payload_json,sync_state FROM copilot_knowledge WHERE id=? AND store_id=? AND owner_id=?",
          content.knowledgeId,
          storeId ?? "",
          ownerId ?? "",
        )
        .then((row) => {
          if (active) {
            setSaved(
              row
                ? {
                    entity: copilotKnowledgeSchema.parse(
                      JSON.parse(row.payload_json),
                    ),
                    syncState: row.sync_state,
                  }
                : null,
            );
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
      return () => {
        active = false;
      };
    }, [sqlite, content.knowledgeId, storeId, ownerId]),
  );
  if (message.storeId !== storeId || message.ownerId !== ownerId) return null;
  return (
    <SectionCard
      title={
        saved
          ? saved.entity.status === "FORGOTTEN"
            ? "Information oubliée"
            : "Pratique mémorisée"
          : "Retenir pour nos prochaines discussions ?"
      }
      description={
        saved
          ? saved.syncState === "SYNCED"
            ? "Votre décision a été synchronisée."
            : "Votre décision est conservée sur cet appareil ; vérifiez sa synchronisation dans la mémoire."
          : "Vous pourrez modifier le texte avant de confirmer. Aucune mémorisation sans votre confirmation."
      }
    >
      {saved?.entity.status !== "FORGOTTEN" ? (
        <Text
          selectable
          style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}
        >
          {saved?.entity.statement ?? content.suggestion.statement}
        </Text>
      ) : null}
      {failed ? (
        <Text style={{ color: colors.muted }}>
          La mémoire ne peut pas être vérifiée maintenant.
        </Text>
      ) : null}
      <SecondaryButton
        label={
          saved
            ? "Voir la mémoire"
            : saved === undefined
              ? "Vérification…"
              : "Vérifier et mémoriser"
        }
        disabled={saved === undefined && !failed}
        onPress={() =>
          router.push(
            saved
              ? { pathname: "/copilot-memory" }
              : {
                  pathname: "/copilot-memory",
                  params: { proposal: message.id },
                },
          )
        }
      />
    </SectionCard>
  );
}
