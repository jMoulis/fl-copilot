import { useCallback, useState, useMemo, useRef, useLayoutEffect } from "react";
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
  const context = useMemo(
    () => ({
      sqlite,
      ownerId,
      storeId,
      knowledgeId: content.knowledgeId,
      owned:
        message.storeId === storeId &&
        message.ownerId === ownerId &&
        !!ownerId &&
        !!storeId,
    }),
    [
      sqlite,
      ownerId,
      storeId,
      content.knowledgeId,
      message.storeId,
      message.ownerId,
    ],
  );
  type Read = {
    context: typeof context;
    saved: { entity: CopilotKnowledge; syncState: string } | null | undefined;
    failed: boolean;
  };
  const [state, setState] = useState<Read>();
  const read = state?.context === context ? state : undefined;
  const saved = read?.saved,
    failed = read?.failed ?? false;
  const lifetime = useRef<{
    context: typeof context;
    active: boolean;
    focused: boolean;
  } | null>(null);
  const latest = useRef(read);
  useLayoutEffect(() => {
    const value = { context, active: true, focused: false };
    lifetime.current = value;
    return () => {
      value.active = false;
    };
  }, [context]);
  useLayoutEffect(() => {
    latest.current = read;
  }, [read]);
  useFocusEffect(
    useCallback(() => {
      const value = lifetime.current;
      if (!context.owned || !value || value.context !== context) return;
      value.focused = true;
      let active = true;
      const current = () =>
        active && value.active && value.focused && lifetime.current === value;
      setState({ context, saved: undefined, failed: false });
      void context.sqlite
        .getFirstAsync<{ payload_json: string; sync_state: string }>(
          "SELECT payload_json,sync_state FROM copilot_knowledge WHERE id=? AND store_id=? AND owner_id=?",
          context.knowledgeId,
          context.storeId!,
          context.ownerId!,
        )
        .then((row) => {
          if (!current()) return;
          const entity = row
            ? copilotKnowledgeSchema.parse(JSON.parse(row.payload_json))
            : null;
          if (
            entity &&
            (entity.id !== context.knowledgeId ||
              entity.storeId !== context.storeId ||
              entity.ownerId !== context.ownerId)
          )
            throw Error("COPILOT_KNOWLEDGE_SCOPE_INVALID");
          setState({
            context,
            saved: entity && row ? { entity, syncState: row.sync_state } : null,
            failed: false,
          });
        })
        .catch(() => {
          if (current()) setState({ context, saved: undefined, failed: true });
        });
      return () => {
        active = false;
        value.focused = false;
      };
    }, [context]),
  );
  if (!context.owned) return null;
  return (
    <SectionCard
      title={
        saved
          ? saved.entity.status === "FORGOTTEN"
            ? "Information oubliée"
            : "Pratique mémorisée"
          : saved === undefined
            ? "Vérifier la mémoire"
            : "Retenir pour nos prochaines discussions ?"
      }
      description={
        saved
          ? saved.syncState === "SYNCED"
            ? "Votre décision a été synchronisée."
            : "Votre décision est conservée sur cet appareil ; vérifiez sa synchronisation dans la mémoire."
          : failed
            ? "Consultez la mémoire avant toute modification : votre décision actuelle n’est pas vérifiée."
            : saved === undefined
              ? "Lecture de votre décision sur cet appareil…"
              : "Vous pourrez modifier le texte avant de confirmer. Aucune mémorisation sans votre confirmation."
      }
    >
      {saved === null || saved?.entity.status === "ACTIVE" ? (
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
          saved || failed
            ? "Voir la mémoire"
            : saved === undefined
              ? "Vérification…"
              : "Vérifier et mémoriser"
        }
        disabled={saved === undefined && !failed}
        onPress={() => {
          const value = lifetime.current,
            snapshot = latest.current;
          if (
            !value?.active ||
            !value.focused ||
            value.context !== context ||
            !snapshot ||
            snapshot.context !== context ||
            (snapshot.saved === undefined && !snapshot.failed)
          )
            return;
          router.push(
            snapshot.saved || snapshot.failed
              ? { pathname: "/copilot-memory" }
              : {
                  pathname: "/copilot-memory",
                  params: { proposal: message.id },
                },
          );
        }}
      />
    </SectionCard>
  );
}
