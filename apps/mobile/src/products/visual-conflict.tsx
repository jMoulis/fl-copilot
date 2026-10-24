import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
} from "expo-crypto";
import { useReviewedConflict } from "../components/use-reviewed-conflict";
import type {
  VisualAsset,
  VisualEntityMap,
  VisualEntityType,
} from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import type { SyncConflict } from "../sync/conflict-repository";
import {
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from "../components/ui";
import { VisualConflictRepository } from "./visual-conflict-repository";
import { visualConflictSummary } from "./visual-conflict-presentation";
import { nativeVisualFileStorage } from "./visual-file-storage";
import { VisualFileCache } from "./visual-file-cache";
import { colors } from "../design/tokens";

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
export function VisualReviewCheck({
  checked,
  disabled,
  label,
  onPress,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        padding: 12,
        borderWidth: 1,
        borderRadius: 12,
        borderColor: checked ? colors.forest : colors.line,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text className="text-base text-ink">
        {checked ? "☑" : "☐"} {label}
      </Text>
    </Pressable>
  );
}
export function VisualVersion({
  title,
  entity,
  labels,
  preview,
}: {
  title: string;
  entity: VisualEntityMap[VisualEntityType];
  labels: Record<string, string>;
  preview: VisualAsset | null;
}) {
  const { sqlite } = useLocalDatabase();
  const [uri, setUri] = useState<string | null>(),
    [busy, setBusy] = useState(false);
  const live = useRef(0);
  useFocusEffect(
    useCallback(() => {
      live.current++;
      return () => {
        live.current++;
      };
    }, []),
  );
  async function open() {
    if (!preview || busy) return;
    const run = live.current;
    setBusy(true);
    try {
      const cached = await new VisualFileCache(sqlite)
        .get(preview.storeId, preview, "PREVIEW")
        .catch(() => null);
      const thumbnail = cached?.manifest
        ? await nativeVisualFileStorage
            .uri(preview.storeId, "PREVIEW", {
              contentHash: cached.manifest.preview.contentHash,
              mimeType: cached.manifest.preview.mimeType,
              sizeBytes: cached.manifest.preview.sizeBytes,
            })
            .catch(() => null)
        : null;
      const source =
        thumbnail ??
        (await nativeVisualFileStorage
          .uri(preview.storeId, "SOURCE", preview)
          .catch(() => null));
      if (live.current === run) setUri(source);
    } finally {
      if (live.current === run) setBusy(false);
    }
  }
  return (
    <SectionCard title={title}>
      {visualConflictSummary(entity, labels).map((line, i) => (
        <Text key={i} className="text-base text-ink">
          {line}
        </Text>
      ))}
      <Text className="text-sm text-muted">
        Version {entity.version} ·{" "}
        {new Date(entity.updatedAt).toLocaleString("fr-FR")}
      </Text>
      {preview ? (
        <SecondaryButton
          label={busy ? "Lecture…" : "Voir la photo conservée sur cet appareil"}
          disabled={busy}
          onPress={() => void open()}
        />
      ) : null}
      {uri ? (
        <Image
          source={{ uri }}
          resizeMode="contain"
          style={{ width: "100%", height: 180 }}
          accessibilityLabel="Photo conservée pour comparer les versions"
        />
      ) : uri === null ? (
        <Text className="text-sm text-muted">
          La photo n’est pas disponible sur cet appareil. Aucune source n’a été
          supprimée.
        </Text>
      ) : null}
    </SectionCard>
  );
}
