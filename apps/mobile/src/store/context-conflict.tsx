import { useAuth } from "@/auth/auth-provider";
import { useMemo, useCallback } from "react";
import { Text, View, Switch } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import type { SyncConflict } from "@/sync/conflict-repository";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { StoreContextRepository } from "./context-repository";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { storeContextSummary, storeContextError } from "./context-presentation";

const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function StoreContextConflict({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <StoreContextConflictReview
      key={`${session.user.id}:${store.storeId}:${conflict.id}:${deviceId}`}
      conflict={conflict}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez ce conflit depuis le magasin auquel ce réglage appartient."
    />
  );
}
function StoreContextConflictReview({ conflict }: { conflict: SyncConflict }) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repository = useMemo(
      () => new StoreContextRepository(sqlite, digest),
      [sqlite],
    );
  const scope = useMemo(
    () => ({
      repository,
      deviceId,
      storeId: conflict.storeId,
      conflictId: conflict.id,
    }),
    [repository, deviceId, conflict.storeId, conflict.id],
  );
  const read = useCallback(
    () => repository.review(conflict.storeId, conflict.id),
    [repository, conflict.storeId, conflict.id],
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
    canChoose: (r) => r.canResolve,
    choose: (r, useLocal, lifetime) =>
      repository.resolve(conflict.id, useLocal, {
        storeId: conflict.storeId,
        commandId: randomUUID(),
        remoteHistoryId: randomUUID(),
        deviceId,
        reviewHash: r.hash,
        ...lifetime,
      }),
    errorText: (reason) =>
      storeContextError(reason instanceof Error ? reason.message : undefined),
    onSuccess: () => {
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    },
    readError:
      "La comparaison ne peut pas être lue. Les réglages et modifications restent conservés ; réessayez la lecture.",
    reloadError:
      "La comparaison ne peut pas être relue. Vos réglages sont conservés.",
  });
  return (
    <>
      {reading ? (
        <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Mes réglages locaux">
        <Text className="text-base text-ink">
          {review
            ? storeContextSummary(review.current.entity)
            : "Lecture des réglages locaux…"}
        </Text>
      </SectionCard>
      <SectionCard title="Réglages synchronisés">
        <Text className="text-base text-ink">
          {review?.group.remote
            ? storeContextSummary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-sm text-muted">
          {review!.group.conflicts.length} conflits concernent ces mêmes
          réglages. Votre choix porte sur les réglages locaux actuels et la
          version synchronisée v{review?.group.remote?.version}. Les versions
          précédentes restent conservées.
        </Text>
      ) : null}
      <Text className="text-sm text-muted">
        Les versions et les modifications locales restent dans l’historique.
        Aucune n’est retenue automatiquement.
      </Text>
      {review?.reason ? (
        <InlineAlert title="Comparaison à revoir" message={review.reason} />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <View className="flex-row items-center gap-3">
        <Switch
          accessibilityLabel="J’ai comparé les réglages locaux et synchronisés"
          value={compared}
          disabled={busy || reading || !!error || !review?.canResolve}
          onValueChange={setCompared}
        />
        <Text className="flex-1 text-base text-ink">
          J’ai comparé les réglages locaux et synchronisés.
        </Text>
      </View>
      <SecondaryButton
        label="Conserver mes réglages locaux"
        disabled={
          busy || reading || !!error || !review?.canResolve || !compared
        }
        onPress={() => void resolve(true)}
      />
      <SecondaryButton
        label="Adopter les réglages synchronisés"
        disabled={
          busy || reading || !!error || !review?.canResolve || !compared
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
