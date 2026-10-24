import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { CopilotConversation } from "@fl-copilot/domain";
import { colors } from "../design/tokens";

/** Native entry points only; the host owns canonical deletion and synchronization. */
export function ConversationMenuRow({
  conversation,
  context,
  enabled,
  onOpen,
  onDelete,
}: {
  conversation: CopilotConversation;
  context: object;
  enabled: boolean;
  onOpen(): void;
  onDelete(signal: AbortSignal): Promise<void>;
}) {
  const scope = useMemo(
    () => ({
      context,
      conversationId: conversation.id,
      storeId: conversation.storeId,
      ownerId: conversation.ownerId,
      enabled,
      cancel: undefined as AbortController | undefined,
      busy: false,
    }),
    [
      context,
      conversation.id,
      conversation.storeId,
      conversation.ownerId,
      enabled,
    ],
  );
  const live = useRef<typeof scope | null>(null);
  const focused = useRef(false);
  const [state, setState] = useState<{
    scope: typeof scope;
    busy: boolean;
    error?: string;
  }>();
  const busy = state?.scope === scope && state.busy;
  const error = state?.scope === scope ? state.error : undefined;
  useLayoutEffect(() => {
    live.current = scope;
    return () => {
      scope.cancel?.abort();
      if (live.current === scope) live.current = null;
    };
  }, [scope]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setState({ scope, busy: false });
      return () => {
        focused.current = false;
        scope.cancel?.abort();
        scope.cancel = undefined;
        scope.busy = false;
      };
    }, [scope]),
  );
  function requestDeletion() {
    if (!enabled || !focused.current || live.current !== scope || scope.cancel)
      return;
    const cancel = new AbortController();
    scope.cancel = cancel;
    const current = () =>
      live.current === scope &&
      focused.current &&
      scope.cancel === cancel &&
      !cancel.signal.aborted;
    Alert.alert(
      "Supprimer cette conversation ?",
      "Elle sera retirée du fil et du contexte du copilote. Les fichiers, les souvenirs mémorisés et les actions déjà confirmées sont conservés.",
      [
        {
          text: "Annuler",
          style: "cancel",
          onPress: () => {
            if (scope.cancel !== cancel || scope.busy) return;
            cancel.abort();
            if (scope.cancel === cancel) scope.cancel = undefined;
          },
        },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => {
            if (!current() || scope.busy) return;
            scope.busy = true;
            setState({ scope, busy: true });
            void (async () => {
              try {
                await onDelete(cancel.signal);
                if (current()) setState({ scope, busy: false });
              } catch {
                if (current())
                  setState({
                    scope,
                    busy: false,
                    error:
                      "La conversation n’a pas pu être supprimée. Réessayez.",
                  });
              } finally {
                if (scope.cancel === cancel) {
                  scope.busy = false;
                  scope.cancel = undefined;
                }
              }
            })();
          },
        },
      ],
    );
  }
  const deleteLabel = `Supprimer la conversation ${conversation.title}`;
  return (
    <View style={styles.container}>
      <Swipeable
        overshootRight={false}
        renderRightActions={(_progress, _translation, methods) => (
          <Pressable
            accessible={false}
            aria-hidden
            accessibilityRole="button"
            accessibilityLabel={deleteLabel}
            accessibilityState={{ disabled: !enabled || busy, busy }}
            disabled={!enabled || busy}
            style={styles.swipeDelete}
            onPress={() => {
              methods.close();
              requestDeletion();
            }}
          >
            <Text style={styles.swipeLabel}>Supprimer</Text>
          </Pressable>
        )}
      >
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${conversation.title}. Créée le ${new Date(conversation.createdAt).toLocaleString("fr-FR")}`}
            accessibilityState={{ disabled: !enabled || busy }}
            disabled={!enabled || busy}
            style={styles.open}
            onPress={() => {
              if (
                enabled &&
                focused.current &&
                !scope.busy &&
                live.current === scope
              )
                onOpen();
            }}
          >
            <Ionicons
              name="chatbubble-outline"
              size={22}
              color={colors.forest}
              accessible={false}
            />
            <View style={styles.titleBlock}>
              <Text numberOfLines={2} style={styles.title}>
                {conversation.title}
              </Text>
              <Text style={styles.date}>
                {new Date(conversation.createdAt).toLocaleString("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={deleteLabel}
            accessibilityHint="Demande confirmation avant de supprimer cette conversation."
            accessibilityState={{ disabled: !enabled || busy, busy }}
            disabled={!enabled || busy}
            style={styles.visibleDelete}
            onPress={requestDeletion}
          >
            <Ionicons
              name="trash-outline"
              size={21}
              color={colors.muted}
              accessible={false}
            />
          </Pressable>
        </View>
      </Swipeable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    paddingRight: 4,
  },
  open: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    padding: 16,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "600", lineHeight: 24 },
  date: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  visibleDelete: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDelete: {
    minWidth: 100,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.critical,
    borderRadius: 16,
    marginLeft: 8,
  },
  swipeLabel: { color: colors.onAccent, fontWeight: "600" },
  error: { color: colors.critical, lineHeight: 22 },
});
