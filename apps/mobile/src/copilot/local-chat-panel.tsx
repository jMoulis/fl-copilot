import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { CopilotChatView } from "./chat-view";
import type { CopilotLocalChatController } from "./local-chat-controller";
import { colors } from "../design/tokens";
type Snapshot = Awaited<ReturnType<CopilotLocalChatController["open"]>>;
type PanelProps = {
  controller: CopilotLocalChatController;
  conversationId: string;
  scopeKey: string;
  onConversations(): void;
};
/** Caller supplies actor/store scope identity; switching scope/topic resets all ephemeral UI. */
export function CopilotLocalChatPanel(props: PanelProps) {
  return (
    <LocalChatPanel
      key={`${props.scopeKey}/${props.conversationId}`}
      {...props}
    />
  );
}
function LocalChatPanel({
  controller,
  conversationId,
  onConversations,
}: PanelProps) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loadedController, setLoadedController] =
    useState<CopilotLocalChatController>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const locked = useRef(false);
  const current = useRef({ controller, conversationId });
  useEffect(() => {
    current.current = { controller, conversationId };
    let alive = true;
    void controller
      .open(conversationId)
      .then((value) => {
        if (alive) {
          setLoadedController(controller);
          setSnapshot(value);
          setDraft(value.draft?.text ?? "");
          setError(undefined);
        }
      })
      .catch(() => {
        if (alive) setError("La conversation locale ne peut pas être ouverte.");
      });
    return () => {
      alive = false;
    };
  }, [controller, conversationId]);
  const isCurrent = () =>
    current.current.controller === controller &&
    current.current.conversationId === conversationId;
  if (
    !snapshot ||
    loadedController !== controller ||
    snapshot.conversation.id !== conversationId
  )
    return (
      <View style={{ flex: 1, padding: 24, backgroundColor: colors.canvas }}>
        {!error ? (
          <ActivityIndicator accessibilityLabel="Ouverture de la conversation" />
        ) : null}
        <Text style={{ color: colors.critical }}>
          {error ?? "Ouverture de la conversation…"}
        </Text>
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={onConversations}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: colors.forest }}>
              Retour aux conversations
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  const change = (text: string) => {
    setDraft(text);
    void controller
      .edit(conversationId, {
        text,
        attachments: snapshot.draft?.attachments ?? [],
      })
      .catch(() => {
        if (isCurrent())
          setError(
            "Le brouillon n’a pas pu être enregistré. Votre texte reste affiché.",
          );
      });
  };
  const send = async () => {
    if (locked.current) return;
    locked.current = true;
    setSending(true);
    setError(undefined);
    try {
      await controller.send(conversationId);
      const value = await controller.open(conversationId);
      if (isCurrent()) {
        setSnapshot(value);
        setDraft(value.draft?.text ?? "");
      }
    } catch {
      if (isCurrent())
        setError(
          "La question n’a pas pu être enregistrée. Votre brouillon est conservé.",
        );
    } finally {
      locked.current = false;
      if (isCurrent()) setSending(false);
    }
  };
  const queued = snapshot.pendingTurns.length > 0;
  return (
    <CopilotChatView
      title={snapshot.conversation.title}
      messages={snapshot.messages.map((message) => message.entity)}
      draft={draft}
      status={sending || queued ? "QUEUED" : "IDLE"}
      error={error}
      onDraftChange={change}
      onSend={() => {
        void send();
      }}
      onConversations={onConversations}
    />
  );
}
