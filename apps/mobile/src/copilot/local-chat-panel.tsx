import type { ReactNode } from "react";
import { mergeCopilotHistory } from "./history-window";
import { CommercialOriginalButton } from "../commercial/original-button";
import type { CopilotMessage } from "@fl-copilot/domain";
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
  renderToolMessage?(message: CopilotMessage): ReactNode;
  onAttachPdf?(signal: AbortSignal): Promise<string | undefined>;
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
  onAttachPdf,
  renderToolMessage,
}: PanelProps) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loadedController, setLoadedController] =
    useState<CopilotLocalChatController>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const attachmentAbort = useRef<AbortController | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const olderLocked = useRef(false);
  const locked = useRef(false);
  const draftRevision = useRef(0);
  const current = useRef<{
    controller: CopilotLocalChatController | undefined;
    conversationId: string;
  }>({ controller, conversationId });
  useEffect(() => {
    current.current = { controller, conversationId };
    let alive = true;
    void controller
      .open(conversationId)
      .then(async (value) => {
        if (alive) {
          setLoadedController(controller);
          setSnapshot((previous) =>
            previous
              ? { ...value, ...mergeCopilotHistory(previous, value) }
              : value,
          );
          setDraft(value.draft?.text ?? "");
          setError(undefined);
          if (delivery && value.pendingTurns.length) {
            setSending(true);
            try {
              await delivery.deliver(conversationId);
            } catch (reason) {
              if (alive) setError(replyError(reason));
            } finally {
              try {
                const revision = draftRevision.current;
                const refreshed = await controller.open(
                  conversationId,
                  value.messages.at(-1)?.entity,
                );
                if (alive) {
                  setSnapshot((previous) =>
                    previous
                      ? {
                          ...refreshed,
                          ...mergeCopilotHistory(previous, refreshed),
                        }
                      : refreshed,
                  );
                  if (revision === draftRevision.current)
                    setDraft(refreshed.draft?.text ?? "");
                }
              } catch {
                if (alive)
                  setError("L’historique local ne peut pas être actualisé.");
              } finally {
                if (alive) setSending(false);
              }
            }
          }
        }
      })
      .catch(() => {
        if (alive) setError("La conversation locale ne peut pas être ouverte.");
      });
    return () => {
      alive = false;
      delivery?.cancel(conversationId);
      attachmentAbort.current?.abort();
      current.current = { controller: undefined, conversationId: "" };
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
    void controller.editText(conversationId, text).catch(() => {
      if (isCurrent())
        setError(
          "Le brouillon n’a pas pu être enregistré. Votre texte reste affiché.",
        );
    });
  };
  const send = async () => {
    if (locked.current || attachmentAbort.current) return;
    locked.current = true;
    setSending(true);
    setError(undefined);
    try {
      await controller.send(conversationId);
      const revision = draftRevision.current;
      const value = await controller.open(
        conversationId,
        snapshot?.messages.at(-1)?.entity,
      );
      if (isCurrent()) {
        setSnapshot((previous) =>
          previous
            ? { ...value, ...mergeCopilotHistory(previous, value) }
            : value,
        );
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
    if (!delivery || attachmentAbort.current) return;
    setSending(true);
    setError(undefined);
    try {
      await delivery.deliver(conversationId);
    } catch (reason) {
      if (isCurrent()) setError(replyError(reason));
    } finally {
      try {
        const revision = draftRevision.current;
        const value = await controller.open(
          conversationId,
          snapshot?.messages.at(-1)?.entity,
        );
        if (isCurrent()) {
          setSnapshot((previous) =>
            previous
              ? { ...value, ...mergeCopilotHistory(previous, value) }
              : value,
          );
          if (revision === draftRevision.current)
            setDraft(value.draft?.text ?? "");
        }
      } catch {
        if (isCurrent())
          setError("L’historique local ne peut pas être actualisé.");
      } finally {
        if (isCurrent()) setSending(false);
      }
    }
  }
  async function loadOlder() {
    if (olderLocked.current || !snapshot?.hasMore || !snapshot.before) return;
    olderLocked.current = true;
    setLoadingOlder(true);
    setHistoryError(undefined);
    try {
      const page = await controller.older(conversationId, snapshot.before);
      if (isCurrent())
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                ...mergeCopilotHistory(previous, page, "OLDER"),
              }
            : previous,
        );
    } catch {
      if (isCurrent())
        setHistoryError(
          "Les messages précédents ne peuvent pas être lus. Réessayez.",
        );
    } finally {
      olderLocked.current = false;
      if (isCurrent()) setLoadingOlder(false);
    }
  }
  async function attach() {
    if (!onAttachPdf || attachmentAbort.current || locked.current) return;
    const attempt = new AbortController();
    attachmentAbort.current = attempt;
    setAttaching(true);
    setError(undefined);
    try {
      const sourceId = await onAttachPdf(attempt.signal);
      if (!sourceId || !isCurrent() || attempt.signal.aborted) return;
      const value = await controller.attachPdf(
        conversationId,
        sourceId,
        attempt.signal,
      );
      if (isCurrent())
        setSnapshot((previous) =>
          previous ? { ...previous, draft: value } : previous,
        );
    } catch (reason) {
      if (isCurrent() && !attempt.signal.aborted)
        setError(attachmentError(reason));
    } finally {
      if (attachmentAbort.current === attempt)
        attachmentAbort.current = undefined;
      if (isCurrent()) setAttaching(false);
    }
  }
  async function removeAttachment(sourceId: string) {
    if (attachmentAbort.current || locked.current) return;
    try {
      const value = await controller.removeAttachment(conversationId, sourceId);
      if (isCurrent())
        setSnapshot((previous) =>
          previous ? { ...previous, draft: value ?? null } : previous,
        );
    } catch {
      if (isCurrent())
        setError(
          "La pièce jointe n’a pas pu être retirée du brouillon. Réessayez.",
        );
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
      draftAttachments={snapshot.draft?.attachments ?? []}
      attaching={attaching}
      onAttach={
        onAttachPdf
          ? () => {
              void attach();
            }
          : undefined
      }
      onRemoveAttachment={(sourceId) => {
        void removeAttachment(sourceId);
      }}
      onDraftChange={change}
      onSend={() => {
        void send();
      }}
      onRetry={
        delivery && queued && !attaching
          ? () => {
              void receive();
            }
          : undefined
      }
      onConversations={onConversations}
      onOlder={
        snapshot.hasMore
          ? () => {
              void loadOlder();
            }
          : undefined
      }
      loadingOlder={loadingOlder}
      historyError={historyError}
      renderAttachment={renderCommercialOriginal}
      renderToolMessage={renderToolMessage}
    />
  );
}

function replyError(error: unknown) {
  return error instanceof ApiClientError
    ? error.response.messageFr
    : "La réponse n’a pas pu être reçue. Votre question est conservée.";
}

function renderCommercialOriginal(
  attachment: CopilotMessage["attachments"][number],
  message: CopilotMessage,
) {
  return message.role !== "TOOL" &&
    attachment.mediaType === "application/pdf" ? (
    <CommercialOriginalButton sourceDocumentId={attachment.sourceDocumentId} />
  ) : null;
}

function attachmentError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "COPILOT_PDF_PICKER_UNAVAILABLE")
    return "Le sélecteur de fichiers est indisponible dans cette version de l’application. Une version incluant ce module est nécessaire.";
  if (code === "COPILOT_ATTACHMENT_LIMIT")
    return "Vous pouvez joindre au maximum dix fichiers à une question.";
  if (code.includes("SIZE_INVALID"))
    return "Le PDF est vide ou dépasse la taille acceptée de 100 Mio.";
  if (code.includes("PDF_INVALID"))
    return "Choisissez un PDF commercial valide.";
  return "Le PDF n’a pas pu être joint au brouillon. Un original déjà conservé reste disponible dans Ma semaine ; réessayez pour l’associer.";
}
