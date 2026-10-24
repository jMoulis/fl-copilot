import { VisualVersion, VisualReviewCheck } from "./visual-conflict-preview";
export { VisualVersion } from "./visual-conflict-preview";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import type { SyncConflict } from "../sync/conflict-repository";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import { VisualConflictRepository } from "./visual-conflict-repository";

const digestReview = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
export function VisualLibraryConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth(),
    { deviceId } = useLocalDatabase(),
    store = session?.stores[0],
    owner = session?.user.id;
  return owner &&
    store?.storeId === conflict.storeId &&
    store.role === "MANAGER" ? (
    <ScopedVisualConflict
      key={`${owner}:${store.storeId}:${store.role}:${deviceId}:${conflict.id}:${conflict.entityId}`}
      conflict={conflict}
      owner={owner}
    />
  ) : (
    <InlineAlert
      title="Droits nécessaires"
      message="Un responsable connecté à ce magasin doit comparer les versions. Les sources restent conservées."
    />
  );
}
function ScopedVisualConflict({
  conflict,
  owner,
}: {
  conflict: SyncConflict;
  owner: string;
}) {
  const { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync(),
    repository = useMemo(
      () => new VisualConflictRepository(sqlite, digestReview),
      [sqlite],
    ),
    scope = useMemo(
      () => ({
        repository,
        deviceId,
        owner,
        storeId: conflict.storeId,
        conflictId: conflict.id,
        entityId: conflict.entityId,
      }),
      [
        repository,
        deviceId,
        owner,
        conflict.storeId,
        conflict.id,
        conflict.entityId,
      ],
    ),
    read = useCallback(
      () => repository.review(conflict.storeId, conflict.id, owner),
      [repository, conflict.storeId, conflict.id, owner],
    ),
    [selection, setSelection] = useState<{
      hash: string;
      side: "LOCAL" | "REMOTE";
      extra: boolean;
      rights: boolean;
    } | null>(null);
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
    canChoose: (r, local) => {
      const selected =
          selection?.hash === r.hash &&
          selection.side === (local ? "LOCAL" : "REMOTE"),
        reactivation = local ? r.reactivateLocal : r.reactivateRemote,
        rights =
          local &&
          !r.current.entity.deletedAt &&
          "provenance" in r.current.entity &&
          r.current.entity.provenance.type === "USER_UPLOAD";
      return (
        !!selected &&
        (local ? r.canKeep : r.canAdopt) &&
        (!reactivation || !!selection?.extra) &&
        (!rights || !!selection?.rights)
      );
    },
    choose: (r, local, lifetime) =>
      repository.resolve(conflict.storeId, conflict.id, local, {
        actorId: owner,
        deviceId,
        commandId: randomUUID(),
        reviewHash: r.hash,
        reactivate: selection?.extra,
        rightsConfirmed: selection?.rights,
        ...lifetime,
      }),
    errorText: () =>
      "La comparaison a changé ou vos droits ne sont plus disponibles. Les sources restent conservées. Relisez les versions avant de confirmer.",
    onSuccess: () => {
      void syncNow(conflict.storeId).catch(() => undefined);
      router.back();
    },
  });
  const decision =
      selection?.hash === review?.hash ? (selection?.side ?? null) : null,
    extra = !!decision && !!selection?.extra,
    rights = !!decision && !!selection?.rights,
    needsExtra =
      decision === "LOCAL"
        ? review?.reactivateLocal
        : decision === "REMOTE"
          ? review?.reactivateRemote
          : false,
    needsRights =
      decision === "LOCAL" &&
      review &&
      !review.current.entity.deletedAt &&
      "provenance" in review.current.entity &&
      review.current.entity.provenance.type === "USER_UPLOAD",
    enabled =
      !!decision &&
      compared &&
      (!needsExtra || extra) &&
      (!needsRights || rights) &&
      !busy &&
      !reading &&
      !error &&
      (decision === "LOCAL" ? review?.canKeep : review?.canAdopt);
  return (
    <View className="gap-4">
      {reading ? (
        <ActivityIndicator accessibilityLabel="Lecture des versions du visuel" />
      ) : null}
      {review ? (
        <>
          <VisualVersion
            key={`${review.hash}:local`}
            title="Votre choix"
            entity={review.current.entity}
            labels={review.labels}
            preview={review.previews.local}
          />
          <VisualVersion
            key={`${review.hash}:remote`}
            title="Choix synchronisé"
            entity={review.remote}
            labels={review.labels}
            preview={review.previews.remote}
          />
          {review.reason ? (
            <InlineAlert title="À vérifier" message={review.reason} />
          ) : null}
          {review.group.conflicts.length > 1 ? (
            <Text className="text-muted">
              {review.group.conflicts.length} conflits concernent ce même
              élément. Le choix utilise la version locale actuelle et la version
              synchronisée v{review.remote.version} ; les versions précédentes
              restent conservées.
            </Text>
          ) : null}
          <Text className="text-base text-muted">
            Le choix porte sur cet élément visuel. Les originaux, les
            provenances et l’historique restent conservés.
          </Text>
          {(["LOCAL", "REMOTE"] as const).map((side) => (
            <SecondaryButton
              key={side}
              label={`${decision === side ? "✓ " : ""}${side === "LOCAL" ? "Garder mon choix" : "Garder le choix synchronisé"}`}
              disabled={
                busy ||
                reading ||
                !!error ||
                !(side === "LOCAL" ? review.canKeep : review.canAdopt)
              }
              onPress={() => {
                setSelection({
                  hash: review.hash,
                  side,
                  extra: false,
                  rights: false,
                });
                setCompared(false);
              }}
            />
          ))}
          {needsExtra ? (
            <VisualReviewCheck
              checked={extra}
              disabled={busy || reading || !!error}
              label="Je confirme explicitement la remise en diffusion de cet élément retiré ou supprimé."
              onPress={() =>
                setSelection(selection ? { ...selection, extra: !extra } : null)
              }
            />
          ) : null}
          {needsRights ? (
            <VisualReviewCheck
              checked={rights}
              disabled={busy || reading || !!error}
              label="Je confirme disposer des droits d’utilisation de cette photo."
              onPress={() =>
                setSelection(
                  selection ? { ...selection, rights: !rights } : null,
                )
              }
            />
          ) : null}
          <VisualReviewCheck
            checked={compared}
            disabled={busy || reading || !!error || !decision}
            label="J’ai comparé les deux versions et je confirme mon choix."
            onPress={() => setCompared(!compared)}
          />
          <PrimaryButton
            label={busy ? "Enregistrement…" : "Confirmer cette résolution"}
            disabled={!enabled}
            onPress={() => void resolve(decision === "LOCAL")}
          />
        </>
      ) : null}
      {error ? (
        <InlineAlert title="Comparaison à reprendre" message={error} />
      ) : null}
      <SecondaryButton
        label="Relire la comparaison"
        disabled={busy || reading}
        onPress={() => {
          setSelection(null);
          reload();
        }}
      />
    </View>
  );
}
export { VisualReviewCheck } from "./visual-conflict-preview";
