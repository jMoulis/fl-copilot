import { useCallback, useMemo, useState } from "react";
import { Switch, Text, View } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import type { SyncConflict } from "../sync/conflict-repository";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { InlineAlert, SecondaryButton } from "../components/ui";
import { StoreLayoutRepository } from "./layout-repository";
import { LayoutComparison } from "./layout-comparison";
import { layoutError } from "./layout-view-model";

const digest = (value: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
export function StoreLayoutConflict({
  conflict,
  onResolved,
}: {
  conflict: SyncConflict;
  onResolved?: () => void;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0];
  return session && store?.storeId === conflict.storeId ? (
    <LayoutConflictReview
      key={`${session.user.id}:${store.storeId}:${store.role}:${deviceId}:${conflict.id}`}
      conflict={conflict}
      actorId={session.user.id}
      allowed={store.role === "MANAGER"}
      onResolved={onResolved}
    />
  ) : (
    <InlineAlert
      title="Magasin différent"
      message="Ouvrez ce conflit depuis le magasin auquel ce plan appartient."
    />
  );
}
function LayoutConflictReview({
  conflict,
  actorId,
  allowed,
  onResolved,
}: {
  conflict: SyncConflict;
  actorId: string;
  allowed: boolean;
  onResolved?: () => void;
}) {
  const [completed, setCompleted] = useState(false);
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repository = useMemo(
      () => new StoreLayoutRepository(sqlite, randomUUID, undefined, digest),
      [sqlite],
    ),
    scope = useMemo(
      () => ({
        repository,
        deviceId,
        actorId,
        allowed,
        conflictId: conflict.id,
        storeId: conflict.storeId,
      }),
      [repository, deviceId, actorId, allowed, conflict.id, conflict.storeId],
    ),
    read = useCallback(
      () => repository.review(conflict.storeId, conflict.id, actorId),
      [repository, conflict.storeId, conflict.id, actorId],
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
    canChoose: (r) => allowed && r.canResolve,
    choose: async (r, useLocal, lifetime) => {
      if (!allowed || !r.remote) throw Error("STORE_LAYOUT_AUTHORITY_CHANGED");
      await repository.resolve(
        conflict.id,
        {
          useLocal,
          storeId: conflict.storeId,
          localRevisionId: r.local.revisionId,
          remoteRevisionId: r.remote.revisionId,
        },
        {
          actorId,
          deviceId,
          commandId: randomUUID(),
          canWrite: true,
          reviewHash: r.hash,
          ...lifetime,
        },
      );
    },
    errorText: layoutError,
    onSuccess: () => {
      setCompleted(true);
      if (onResolved)
        void Promise.resolve()
          .then(onResolved)
          .catch(() => undefined);
      else {
        void Promise.resolve()
          .then(() => syncNow(conflict.storeId))
          .catch(() => undefined);
        try {
          router.back();
        } catch {
          /* The committed choice remains successful. */
        }
      }
    },
  });
  const disabled =
    !allowed || busy || reading || !!error || !review?.canResolve || !compared;
  return (
    <>
      {reading ? (
        <Text className="text-muted" accessibilityLiveRegion="polite">
          Lecture de la comparaison…
        </Text>
      ) : null}
      {review ? (
        <>
          <Text className="text-muted">
            Votre plan local v{review.local.version} · Plan synchronisé v
            {review.remote?.version ?? "non vérifiée"}
          </Text>
          {review.remote ? (
            <LayoutComparison
              before={review.local.content}
              after={review.remote.content}
            />
          ) : null}
          <Text className="text-muted">
            {review.group.conflicts.length} conflit(s) examiné(s). Conserver
            votre version crée un nouveau brouillon. Les versions et les mesures
            non confirmées restent conservées ; aucun plan n’est choisi comme
            référence automatiquement.
          </Text>
        </>
      ) : null}
      {completed ? (
        <InlineAlert
          title="Comparaison enregistrée"
          message="Votre choix est conservé sur cet appareil. Un envoi éventuel peut rester à synchroniser."
        />
      ) : (
        <>
          {review?.reason ? (
            <InlineAlert title="Comparaison à revoir" message={review.reason} />
          ) : null}
          {error ? (
            <InlineAlert title="Résolution impossible" message={error} />
          ) : null}
          {!allowed ? (
            <InlineAlert
              title="Lecture seule"
              message="Un responsable du magasin peut choisir la version à conserver."
            />
          ) : null}
          <View className="flex-row items-center gap-3">
            <Switch
              accessibilityLabel="J’ai comparé les plans locaux et synchronisés"
              value={compared}
              disabled={
                !allowed || busy || reading || !!error || !review?.canResolve
              }
              onValueChange={setCompared}
            />
            <Text className="flex-1 text-ink">
              J’ai comparé les plans locaux et synchronisés.
            </Text>
          </View>
          <SecondaryButton
            label="Reprendre ma version comme brouillon"
            disabled={disabled}
            onPress={() => void resolve(true)}
          />
          <SecondaryButton
            label="Utiliser la version synchronisée"
            disabled={disabled}
            onPress={() => void resolve(false)}
          />
          <SecondaryButton
            label="Relire la comparaison"
            disabled={busy || reading}
            onPress={reload}
          />
        </>
      )}
    </>
  );
}
