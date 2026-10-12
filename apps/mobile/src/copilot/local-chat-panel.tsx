import { ApiClientError } from "@fl-copilot/api-client";
import type { CopilotTurnDelivery } from "./turn-delivery";
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
  delivery?: CopilotTurnDelivery;
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
  delivery,
}: PanelProps) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loadedController, setLoadedController] =
    useState<CopilotLocalChatController>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const locked = useRef(false);
  const draftRevision = useRef(0);
  const current = useRef({ controller, conversationId });
  useEffect(() => {
    current.current = { controller, conversationId };
    let alive = true;
    void controller
      .open(conversationId)
      .then(async (value) => {
        if (alive) {
          setLoadedController(controller);
          setSnapshot(value);
          setDraft(value.draft?.text ?? "");
          setError(undefined);
          if (delivery && value.pendingTurns.length) {
            setSending(true);
            try {
              await delivery.deliver(conversationId);
              const revision = draftRevision.current;
              const refreshed = await controller.open(conversationId);
              if (alive) {
                setSnapshot(refreshed);
                if (revision === draftRevision.current)
                  setDraft(refreshed.draft?.text ?? "");
              }
            } catch (reason) {
              if (alive) setError(replyError(reason));
            } finally {
              if (alive) setSending(false);
            }
          }
        }
      })
      .catch(() => {
        if (alive) setError("La conversation locale ne peut pas être ouverte.");
      });
    return () => {
      alive = false;
    };
  }, [controller, conversationId, delivery]);
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
    draftRevision.current++;
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
      const revision = draftRevision.current;
      const value = await controller.open(conversationId);
      if (isCurrent()) {
        setSnapshot(value);
        if (revision === draftRevision.current)
          setDraft(value.draft?.text ?? "");
      }
      if (delivery) await receive();
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
  async function receive() {
    if (!delivery) return;
    setSending(true);
    setError(undefined);
    try {
      await delivery.deliver(conversationId);
      const revision = draftRevision.current;
      const value = await controller.open(conversationId);
      if (isCurrent()) {
        setSnapshot(value);
        if (revision === draftRevision.current)
          setDraft(value.draft?.text ?? "");
      }
    } catch (reason) {
      if (isCurrent()) setError(replyError(reason));
    } finally {
      if (isCurrent()) setSending(false);
    }
  }
  const queued = snapshot.pendingTurns.length > 0;
  return (
    <CopilotChatView
      title={snapshot.conversation.title}
      messages={snapshot.messages.map((message) => message.entity)}
      draft={draft}
      status={sending ? "GENERATING" : queued ? "QUEUED" : "IDLE"}
      error={error}
      onDraftChange={change}
      onSend={() => {
        void send();
      }}
      onRetry={
        delivery && queued
          ? () => {
              void receive();
            }
          : undefined
      }
      onConversations={onConversations}
    />
  );
}

function replyError(error: unknown) {
  return error instanceof ApiClientError
    ? error.response.messageFr
    : "La réponse n’a pas pu être reçue. Votre question est conservée.";
}
