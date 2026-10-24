import { router, useLocalSearchParams } from "expo-router";
import {
  AppHeader,
  AppScreen,
  InlineAlert,
  SecondaryButton,
} from "@/components/ui";
import { ConversationConflict } from "@/copilot/conversation-conflict";
export default function ConversationReviewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <AppScreen>
      <AppHeader
        title="Comparer la conversation"
        subtitle="Choisissez les métadonnées ; les suppressions restent préservées."
      />
      {id ? (
        <ConversationConflict conversationId={id} />
      ) : (
        <InlineAlert
          title="Conversation indisponible"
          message="Ouvrez la comparaison depuis vos conversations."
        />
      )}
      <SecondaryButton label="Retour" onPress={() => router.back()} />
    </AppScreen>
  );
}
