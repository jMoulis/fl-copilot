import { useCallback, useMemo } from "react";
import { Switch, Text, View } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { InlineAlert, SecondaryButton, SectionCard } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { CopilotConversationRepository } from "./conversation-repository";
import type { CopilotConversation } from "@fl-copilot/domain";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function ConversationConflict({
  conversationId,
}: {
  conversationId: string;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store ? (
    <ConversationConflictReview
      key={`${session.user.id}:${store.storeId}:${store.role}:${deviceId}:${conversationId}`}
      conversationId={conversationId}
      storeId={store.storeId}
      ownerId={session.user.id}
    />
  ) : (
    <InlineAlert
      title="Conversation privée"
      message="Reconnectez-vous au compte et au magasin de cette conversation pour comparer les versions."
    />
  );
}
function ConversationConflictReview({
  conversationId,
  storeId,
  ownerId,
}: {
  conversationId: string;
  storeId: string;
  ownerId: string;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(
      () =>
        new CopilotConversationRepository(sqlite, { storeId, ownerId }, digest),
      [sqlite, storeId, ownerId],
    ),
    scope = useMemo(
      () => ({ repo, deviceId, conversationId }),
      [repo, deviceId, conversationId],
    ),
    read = useCallback(
      () => repo.review(conversationId),
      [repo, conversationId],
    );
  const {
    review,
    compared,
    setCompared,
    busy,
    reading,
    error,
    resolve,
    reload,
  } = useReviewedConflict({
    scope,
    read,
    canChoose: (r, local) => (local ? r.canKeepLocal : r.canAdoptRemote),
    choose: (r, local, lifetime) =>
      repo.resolve(conversationId, local, {
        storeId,
        ownerId,
        deviceId,
        commandId: randomUUID(),
        reviewCaptureId: randomUUID(),
        reviewHash: r.hash,
        ...lifetime,
      }),
    errorText: () =>
      "La comparaison a changé ou votre accès n’est plus disponible. Les versions et les suppressions sont conservées. Relisez-les avant de décider.",
    onSuccess: () => {
      void syncNow(storeId).catch(() => undefined);
      router.back();
    },
  });
  const summary = (e: CopilotConversation) =>
      `${e.title}\n${e.deletedAt ? "Conversation supprimée" : e.status === "ARCHIVED" ? "Archivée" : "Active"} · version ${e.version}\n${e.deletedMessageIds?.length ?? 0} message(s) explicitement supprimé(s)`,
    canChoose = !!review && (review.canKeepLocal || review.canAdoptRemote);
  return (
    <>
      {reading ? (
        <Text className="text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Votre version locale">
        <Text selectable className="text-ink">
          {review
            ? summary(review.current.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        <Text selectable className="text-ink">
          {review?.group.remote
            ? summary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      <Text className="text-muted">
        Le choix porte sur le titre et l’archivage. Les suppressions connues
        restent effectives dans les deux cas, y compris les réponses à une
        question supprimée. Les fichiers originaux, la mémoire et les actions
        déjà confirmées restent conservés.
      </Text>
      {review?.remoteChoiceNeedsSend ? (
        <Text className="text-muted">
          Adopter les métadonnées synchronisées conservera aussi vos
          suppressions locales : elles resteront à envoyer.
        </Text>
      ) : null}
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-muted">
          {review!.group.conflicts.length} conflits concernent cette
          conversation. Le choix utilise votre version actuelle et la version
          synchronisée v{review?.group.remote?.version} ; les précédentes
          restent conservées.
        </Text>
      ) : null}
      {review?.reason ? (
        <InlineAlert title="Comparaison à revoir" message={review.reason} />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <View className="flex-row items-center gap-3">
        <Switch
          accessibilityLabel="J’ai comparé les métadonnées de la conversation"
          value={compared}
          disabled={busy || reading || !!error || !canChoose}
          onValueChange={setCompared}
        />
        <Text className="flex-1 text-ink">
          J’ai comparé les métadonnées de la conversation.
        </Text>
      </View>
      <SecondaryButton
        label="Conserver ma version locale"
        disabled={
          busy || reading || !!error || !compared || !review?.canKeepLocal
        }
        onPress={() => void resolve(true)}
      />
      <SecondaryButton
        label="Adopter la version synchronisée"
        disabled={
          busy || reading || !!error || !compared || !review?.canAdoptRemote
        }
        onPress={() => void resolve(false)}
      />
      <SecondaryButton
        label="Relire la comparaison"
        disabled={busy || reading}
        onPress={reload}
      />
    </>
  );
}
