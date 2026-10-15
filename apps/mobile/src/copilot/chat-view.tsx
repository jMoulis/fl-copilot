import { CopilotActivityTrail } from "./activity-trail";
import type { CopilotActivity } from "@fl-copilot/sync-contracts";
import { AssistantAnswer } from "./assistant-answer";
import { useRef, type ReactNode } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { CopilotMessage } from "@fl-copilot/domain";
import { colors } from "../design/tokens";

export type CopilotChatStatus = "IDLE" | "QUEUED" | "GENERATING" | "OFFLINE";
const statusLabels: Record<CopilotChatStatus, string> = {
  IDLE: "",
  QUEUED: "Questions conservées, en attente de réponse.",
  GENERATING: "Le copilote prépare sa réponse…",
  OFFLINE: "Hors connexion · vos messages restent disponibles.",
};
/** Controlled native view: the host owns local persistence, authority, requests and retries. */
export function CopilotChatView({
  title,
  messages,
  streamingText,
  activities = [],
  draft,
  status,
  error,
  onDraftChange,
  onSend,
  onConversations,
  onAttach,
  onRetry,
  renderAttachment,
  renderToolMessage,
  onOlder,
  loadingOlder = false,
  historyError,
  draftAttachments = [],
  attaching = false,
  onRemoveAttachment,
  intakeSummary,
  allowIntakeWithoutAttachmentCapacity = false,
}: {
  streamingText?: string;
  activities?: readonly CopilotActivity[];
  intakeSummary?: ReactNode;
  allowIntakeWithoutAttachmentCapacity?: boolean;
  title: string;
  messages: readonly CopilotMessage[];
  draft: string;
  status: CopilotChatStatus;
  error?: string;
  onDraftChange(value: string): void;
  onSend(): void;
  onConversations(): void;
  onAttach?(): void;
  onRetry?(): void;
  onOlder?(): void;
  loadingOlder?: boolean;
  historyError?: string;
  draftAttachments?: CopilotMessage["attachments"];
  attaching?: boolean;
  onRemoveAttachment?(sourceDocumentId: string): void;
  renderToolMessage?(message: CopilotMessage): ReactNode;
  renderAttachment?(
    attachment: CopilotMessage["attachments"][number],
    message: CopilotMessage,
  ): ReactNode;
}) {
  const list = useRef<FlatList<CopilotMessage>>(null);
  const followLatest = useRef(true);
  const visible = messages.filter(
    (message) => message.role !== "TOOL" || !!renderToolMessage?.(message),
  );
  const sending = status === "GENERATING" || status === "QUEUED";
  const canSend =
    (draft.trim().length > 0 || draftAttachments.length > 0) &&
    !sending &&
    !attaching;
  const canAttach =
    !attaching &&
    status !== "GENERATING" &&
    (allowIntakeWithoutAttachmentCapacity || draftAttachments.length < 10);
  const onScroll = ({
    nativeEvent,
  }: NativeSyntheticEvent<NativeScrollEvent>) => {
    followLatest.current =
      nativeEvent.contentSize.height -
        nativeEvent.layoutMeasurement.height -
        nativeEvent.contentOffset.y <
      80;
  };
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir les conversations"
          onPress={onConversations}
          style={styles.menu}
        >
          <Text style={styles.menuText}>☰</Text>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title || "Copilote"}
        </Text>
      </View>
      <FlatList
        ref={list}
        data={visible}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={100}
        contentContainerStyle={styles.history}
        onContentSizeChange={() => {
          if (followLatest.current)
            list.current?.scrollToEnd({ animated: false });
        }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={
          onOlder || historyError || intakeSummary ? (
            <View>
              {intakeSummary}
              {historyError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {historyError}
                </Text>
              ) : null}
              {onOlder ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: loadingOlder,
                    busy: loadingOlder,
                  }}
                  disabled={loadingOlder}
                  onPress={() => {
                    followLatest.current = false;
                    onOlder();
                  }}
                  style={styles.retry}
                >
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.retryText}
                  >
                    {loadingOlder
                      ? "Lecture de l’historique…"
                      : "Voir les messages précédents"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.welcome}>De quoi avez-vous besoin ?</Text>
            <Text style={styles.hint}>
              Préparer la semaine, comprendre les ventes ou faire le point sur
              le rayon.
            </Text>
          </View>
        }
        ListFooterComponent={
          streamingText || status === "GENERATING" ? (
            <View style={{ padding: 20, gap: 12 }}>
              {status === "GENERATING" ? (
                <CopilotActivityTrail activities={activities} />
              ) : null}
              {streamingText ? <AssistantAnswer text={streamingText} /> : null}
            </View>
          ) : null
        }
        renderItem={({ item }) =>
          item.role === "TOOL" ? (
            <View style={styles.assistantMessage}>
              {renderToolMessage?.(item)}
            </View>
          ) : (
            <View
              style={
                item.role === "USER"
                  ? styles.userMessage
                  : styles.assistantMessage
              }
            >
              <Text style={styles.author}>
                {item.role === "USER" ? "Vous" : "Copilote"}
              </Text>
              {item.role === "ASSISTANT" ? (
                <AssistantAnswer
                  text={item.text}
                  renderSource={(id) => {
                    const a = item.attachments.find(
                      (a) => a.sourceDocumentId === id,
                    );
                    return a ? renderAttachment?.(a, item) : null;
                  }}
                />
              ) : (
                <Text selectable style={styles.message}>
                  {item.text}
                </Text>
              )}
              {(item.role === "ASSISTANT" &&
              item.text.includes("copilot-source:")
                ? []
                : item.attachments
              ).map((attachment) => (
                <View key={attachment.sourceDocumentId}>
                  <Text style={styles.attachment}>{attachment.filename}</Text>
                  {renderAttachment?.(attachment, item)}
                </View>
              ))}
            </View>
          )
        }
      />
      <View style={styles.footer}>
        {statusLabels[status] && !streamingText && status !== "GENERATING" ? (
          <Text accessibilityLiveRegion="polite" style={styles.state}>
            {statusLabels[status]}
          </Text>
        ) : null}
        {error ? (
          <View>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          </View>
        ) : null}
        {onRetry && status !== "GENERATING" ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            style={styles.retry}
          >
            <Text style={styles.retryText}>
              {error ? "Réessayer" : "Reprendre les questions en attente"}
            </Text>
          </Pressable>
        ) : null}
        {attaching ? (
          <Text accessibilityLiveRegion="polite" style={styles.state}>
            Conservation du PDF…
          </Text>
        ) : null}
        {draftAttachments.length ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 8 }}
          >
            {draftAttachments.map((attachment) => (
              <View
                key={attachment.sourceDocumentId}
                style={styles.draftAttachment}
              >
                <Text numberOfLines={2} style={styles.draftFilename}>
                  {attachment.filename}
                </Text>
                {onRemoveAttachment ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Retirer ${attachment.filename} du brouillon`}
                    accessibilityState={{
                      disabled: attaching || status === "GENERATING",
                    }}
                    disabled={attaching || status === "GENERATING"}
                    style={styles.menu}
                    onPress={() =>
                      onRemoveAttachment(attachment.sourceDocumentId)
                    }
                  >
                    <Text style={styles.retryText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
        {draftAttachments.length >= 10 ? (
          <Text style={styles.state}>Dix fichiers maximum par question.</Text>
        ) : null}
        <View style={styles.composer}>
          {onAttach ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Joindre des fichiers"
              accessibilityState={{ disabled: !canAttach, busy: attaching }}
              disabled={!canAttach}
              onPress={onAttach}
              style={styles.attach}
            >
              <Text style={styles.menuText}>＋</Text>
              <Text style={styles.attachCaption}>
                {allowIntakeWithoutAttachmentCapacity ? "Fichiers" : "PDF"}
              </Text>
            </Pressable>
          ) : null}
          <TextInput
            accessibilityLabel="Message au copilote"
            placeholder="Écrivez au copilote…"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={6000}
            value={draft}
            onChangeText={onDraftChange}
            style={styles.input}
            textAlignVertical="top"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Envoyer le message"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => {
              if (canSend) {
                followLatest.current = true;
                onSend();
              }
            }}
            style={[styles.send, !canSend && styles.disabled]}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  menu: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  menuText: { fontSize: 25, color: colors.ink },
  title: {
    flex: 1,
    marginLeft: 8,
    fontSize: 19,
    fontWeight: "600",
    color: colors.ink,
  },
  history: { flexGrow: 1, padding: 18, gap: 24 },
  empty: { flex: 1, justifyContent: "center", paddingVertical: 60 },
  welcome: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: "600",
    marginBottom: 12,
  },
  hint: { fontSize: 16, lineHeight: 24, color: colors.muted },
  userMessage: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 20,
    padding: 16,
  },
  assistantMessage: { alignSelf: "stretch", paddingVertical: 4 },
  author: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  message: { color: colors.ink, fontSize: 17, lineHeight: 26 },
  attachment: { color: colors.muted, fontSize: 14, marginTop: 8 },
  footer: { padding: 12, gap: 10, backgroundColor: colors.canvas },
  draftAttachment: {
    width: 240,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingLeft: 12,
  },
  draftFilename: { flex: 1, color: colors.ink, fontSize: 14 },
  attachCaption: { color: colors.muted, fontSize: 11 },
  state: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: colors.critical, fontSize: 14, lineHeight: 21 },
  retry: { minHeight: 44, justifyContent: "center" },
  retryText: { color: colors.forest, fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 26,
    padding: 6,
  },
  attach: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 23,
    padding: 10,
    minHeight: 44,
    maxHeight: 150,
  },
  send: {
    width: 44,
    height: 44,
    backgroundColor: colors.forest,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: colors.surface, fontSize: 25, fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
