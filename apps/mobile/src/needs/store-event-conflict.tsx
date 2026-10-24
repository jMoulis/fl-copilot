import { useMemo, useCallback } from "react";
import { Text, View, Switch } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useAuth } from "@/auth/auth-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
import type { SyncConflict } from "@/sync/conflict-repository";
import { SectionCard, SecondaryButton, InlineAlert } from "@/components/ui";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { StoreProductEventRepository } from "./store-event-repository";
import { storeEventSummary, storeEventError } from "./store-event-presentation";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function StoreEventConflict({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <StoreEventConflictReview
      key={`${session.user.id}:${store.storeId}:${conflict.id}:${deviceId}`}
      conflict={conflict}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez ce conflit depuis le magasin auquel appartient le signalement."
    />
  );
}
function StoreEventConflictReview({ conflict }: { conflict: SyncConflict }) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repo = useMemo(
      () => new StoreProductEventRepository(sqlite, digest),
      [sqlite],
    );
  const scope = useMemo(
      () => ({
        repo,
        deviceId,
        storeId: conflict.storeId,
        conflictId: conflict.id,
      }),
      [repo, deviceId, conflict.storeId, conflict.id],
    ),
    read = useCallback(
      () => repo.review(conflict.storeId, conflict.id),
      [repo, conflict.storeId, conflict.id],
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
    canChoose: (r, useLocal) => (useLocal ? r.canKeepLocal : r.canAdoptRemote),
    choose: (r, useLocal, lifetime) =>
      repo.resolve(conflict.id, useLocal, {
        storeId: conflict.storeId,
        deviceId,
        commandId: randomUUID(),
        remoteHistoryId: randomUUID(),
        capturedAt: new Date().toISOString(),
        reviewHash: r.hash,
        ...lifetime,
      }),
    errorText: (reason) =>
      storeEventError(reason instanceof Error ? reason.message : undefined),
    onSuccess: () => {
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    },
  });
  const canChoose = !!review && (review.canKeepLocal || review.canAdoptRemote);
  return (
    <>
      {reading ? (
        <Text className="text-sm text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      <SectionCard title="Votre observation locale">
        {review ? (
          <Text className="text-base font-semibold text-ink">
            Produit :{" "}
            {review.products[review.current.entity.productId] ??
              "Référence non disponible localement"}
          </Text>
        ) : null}
        <Text className="text-ink">
          {review
            ? storeEventSummary(review.current.entity)
            : "Lecture de la version locale…"}
        </Text>
      </SectionCard>
      <SectionCard title="Version synchronisée">
        {review?.group.remote ? (
          <Text className="text-base font-semibold text-ink">
            Produit :{" "}
            {review.products[review.group.remote.productId] ??
              "Référence non disponible localement"}
          </Text>
        ) : null}
        <Text className="text-ink">
          {review?.group.remote
            ? storeEventSummary(review.group.remote)
            : "Version distante non vérifiée."}
        </Text>
      </SectionCard>
      {(review?.group.conflicts.length ?? 0) > 1 ? (
        <Text className="text-sm text-muted">
          {review!.group.conflicts.length} conflits concernent cette même
          observation. Votre choix porte sur l’observation locale actuelle et la
          version synchronisée v{review?.group.remote?.version}. Les versions
          précédentes restent conservées.
        </Text>
      ) : null}
      <Text className="text-muted">
        Les captures initiales restent immuables. Seule une heure de fin peut
        être confirmée sur une capture identique. Aucune version n’est choisie
        automatiquement.
      </Text>
      {review?.reason ? (
        <InlineAlert
          title={review.ready ? "Capture préservée" : "Comparaison à revoir"}
          message={review.reason}
        />
      ) : null}
      {error ? (
        <InlineAlert title="Résolution impossible" message={error} />
      ) : null}
      <View className="flex-row items-center gap-3">
        <Switch
          accessibilityLabel="J’ai comparé les observations locale et synchronisée"
          value={compared}
          disabled={busy || reading || !!error || !canChoose}
          onValueChange={setCompared}
        />
        <Text className="flex-1 text-base text-ink">
          J’ai comparé les observations locale et synchronisée.
        </Text>
      </View>
      {review?.canKeepLocal ? (
        <SecondaryButton
          label="Confirmer mon heure de fin"
          disabled={busy || reading || !!error || !compared}
          onPress={() => void resolve(true)}
        />
      ) : null}
      <SecondaryButton
        label="Adopter la version synchronisée"
        disabled={
          busy || reading || !!error || !review?.canAdoptRemote || !compared
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
