import { readCopilotImportStatus } from "@fl-copilot/domain";
import { copilotMessageIsDeleted } from "@fl-copilot/domain";
import type { CopilotActivity } from "@fl-copilot/sync-contracts";
import { BottomSheet, MenuRow } from "../components/ui";
import type { CopilotPdfSelection } from "./pdf-selection";
import type { ReactNode } from "react";
import { mergeCopilotHistory } from "./history-window";
import { CommercialAnalysisRecoveryPanel } from "../commercial/analysis-recovery-panel";
import { CommercialOriginalButton } from "../commercial/original-button";
import type { CopilotMessage } from "@fl-copilot/domain";
import { ApiClientError } from "@fl-copilot/api-client";
import type { CopilotTurnDelivery } from "./turn-delivery";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
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
  onRemember?(message: CopilotMessage): void;
  renderToolMessage?(
    message: CopilotMessage,
    onSubmitted: () => Promise<void>,
  ): ReactNode;
  intakeSummary?: ReactNode;
  onOpenMercalys?(): void;
  externalDraftRevision?: number;
  externalMessageRevision?: number;
  onAttachPdf?(
    signal: AbortSignal,
    capacity: number,
  ): Promise<CopilotPdfSelection | undefined>;
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
  onRemember,
  delivery,
  onAttachPdf,
  renderToolMessage,
  onOpenMercalys,
  intakeSummary,
  externalDraftRevision = 0,
  externalMessageRevision = 0,
}: PanelProps) {
  const [activities, setActivities] = useState<CopilotActivity[]>([]);
  useEffect(
    () =>
      delivery?.subscribeActivities(conversationId, (activity) => {
        setActivities((previous) =>
          !activity
            ? []
            : previous.some((a) => a.id === activity.id)
              ? previous.map((a) => (a.id === activity.id ? activity : a))
              : [...previous, activity].slice(-12),
        );
      }),
    [delivery, conversationId],
  );
  const [streamingText, setStreamingText] = useState("");
  useEffect(
    () => delivery?.subscribe(conversationId, setStreamingText),
    [delivery, conversationId],
  );
  const [fileMenu, setFileMenu] = useState(false);
  const queuedFileAction = useRef<"PDF" | "MERCALYS" | undefined>(undefined);
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
    const openingRevision = draftRevision.current;
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
          if (openingRevision === draftRevision.current)
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
                  setStreamingText("");
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
  }, [controller, conversationId, delivery, externalMessageRevision]);
  useEffect(() => {
    if (!externalDraftRevision) return;
    let alive = true;
    const revision = draftRevision.current;
    void controller
      .open(conversationId)
      .then((value) => {
        if (alive && revision === draftRevision.current) {
          setDraft(value.draft?.text ?? "");
          setSnapshot((previous) =>
            previous ? { ...previous, draft: value.draft } : previous,
          );
        }
      })
      .catch(() => {
        if (alive)
          setError(
            "Le brouillon d’analyse ne peut pas être relu. Il reste conservé ; rouvrez la conversation.",
          );
      });
    return () => {
      alive = false;
    };
  }, [controller, conversationId, externalDraftRevision]);
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
    setActivities([]);
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
    setActivities([]);
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
          setStreamingText("");
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
  function performFileAction(kind: "PDF" | "MERCALYS") {
    if (!isCurrent()) return;
    if (kind === "PDF") void attach();
    else onOpenMercalys?.();
  }
  function selectFileAction(kind: "PDF" | "MERCALYS") {
    setFileMenu(false);
    // UIKit must finish dismissing this sheet before another modal/picker opens.
    if (Platform.OS === "ios") queuedFileAction.current = kind;
    else performFileAction(kind);
  }
  async function attach() {
    if (!onAttachPdf || attachmentAbort.current || locked.current) return;
    const attempt = new AbortController();
    attachmentAbort.current = attempt;
    setAttaching(true);
    setError(undefined);
    try {
      const selection = await onAttachPdf(
        attempt.signal,
        10 - (snapshot?.draft?.attachments.length ?? 0),
      );
      if (!selection || !isCurrent() || attempt.signal.aborted) return;
      if (!selection.sourceIds.length) {
        setError(
          selection.failures
            .map((f) => `${f.filename} : ${attachmentError(new Error(f.code))}`)
            .join("\n"),
        );
        return;
      }
      const value = await controller.attachPdfs(
        conversationId,
        selection.sourceIds,
        attempt.signal,
      );
      if (isCurrent())
        setSnapshot((previous) =>
          previous ? { ...previous, draft: value } : previous,
        );
      if (isCurrent() && selection.failures.length)
        setError(
          selection.failures
            .map((f) => `${f.filename} : ${attachmentError(new Error(f.code))}`)
            .join("\n"),
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
    <>
      <CopilotChatView
        activities={activities}
        streamingText={streamingText}
        intakeSummary={intakeSummary}
        allowIntakeWithoutAttachmentCapacity={!!onOpenMercalys}
        title={snapshot.conversation.title}
        messages={snapshot.messages
          .map((message) => message.entity)
          .filter((message) => {
            try {
              readCopilotImportStatus(message);
              return false;
            } catch {
              return true;
            }
          })
          .filter(
            (message) =>
              !copilotMessageIsDeleted(message, snapshot.conversation),
          )}
        draft={draft}
        status={sending ? "GENERATING" : queued ? "QUEUED" : "IDLE"}
        error={error}
        draftAttachments={snapshot.draft?.attachments ?? []}
        attaching={attaching}
        onAttach={
          onAttachPdf || onOpenMercalys
            ? () => {
                if (onOpenMercalys) setFileMenu(true);
                else void attach();
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
        onRemember={onRemember}
        onDeleteMessage={(message) => {
          if (sending || locked.current) return;
          Alert.alert(
            "Supprimer ce message ?",
            message.role === "USER"
              ? "Le message et ses réponses seront retirés du fil et du contexte du copilote. Les fichiers, les souvenirs mémorisés et les actions déjà confirmées sont conservés."
              : "La réponse et ses cartes seront retirées du fil et du contexte du copilote. Les actions déjà confirmées sont conservées.",
            [
              { text: "Annuler", style: "cancel" },
              {
                text: "Supprimer",
                style: "destructive",
                onPress: () => {
                  if (locked.current) return;
                  locked.current = true;
                  void controller
                    .removeMessage(conversationId, message.id)
                    .then(() =>
                      controller.open(
                        conversationId,
                        snapshot.messages[0]?.entity,
                      ),
                    )
                    .then((value) => {
                      if (
                        current.current.controller === controller &&
                        current.current.conversationId === conversationId
                      )
                        setSnapshot(value);
                    })
                    .catch(() => {
                      if (current.current.controller === controller)
                        setError("Le message n’a pas pu être supprimé.");
                    })
                    .finally(() => {
                      locked.current = false;
                    });
                },
              },
            ],
          );
        }}
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
        renderToolMessage={
          renderToolMessage
            ? (message) =>
                renderToolMessage(message, async () => {
                  const refreshed = await controller.open(
                    conversationId,
                    snapshot.messages.at(-1)?.entity,
                  );
                  if (isCurrent())
                    setSnapshot((previous) =>
                      previous
                        ? {
                            ...refreshed,
                            ...mergeCopilotHistory(previous, refreshed),
                          }
                        : refreshed,
                    );
                  if (isCurrent()) await receive();
                })
            : undefined
        }
      />
      <BottomSheet
        visible={fileMenu}
        title="Joindre des fichiers"
        onClose={() => {
          queuedFileAction.current = undefined;
          setFileMenu(false);
        }}
        onDismiss={() => {
          const kind = queuedFileAction.current;
          queuedFileAction.current = undefined;
          if (kind) performFileAction(kind);
        }}
      >
        {onAttachPdf ? (
          <MenuRow
            title="PDF commerciaux"
            description="Prospectus et opérations"
            icon="document-text-outline"
            onPress={() => {
              selectFileAction("PDF");
            }}
          />
        ) : null}
        {onOpenMercalys ? (
          <Text style={{ padding: 12 }}>
            Les références uniques sont créées et les lignes sans ambiguïté sont
            publiées automatiquement, sans attendre les autres produits. Les
            doutes et les remplacements vous seront demandés ici.
          </Text>
        ) : null}
        {onOpenMercalys ? (
          <MenuRow
            title="Importer et traiter : XLSX / ZIP"
            description="Plusieurs fichiers XLSX ou une archive ZIP"
            icon="documents-outline"
            onPress={() => {
              selectFileAction("MERCALYS");
            }}
          />
        ) : null}
      </BottomSheet>
    </>
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
    <View className="gap-2">
      <CommercialOriginalButton
        sourceDocumentId={attachment.sourceDocumentId}
      />
      <CommercialAnalysisRecoveryPanel
        sourceDocumentId={attachment.sourceDocumentId}
      />
    </View>
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
