import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
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
import { digestVisualId } from "./visual-id-digest";
import { visualConflictSummary } from "./visual-conflict-presentation";
import { nativeVisualFileStorage } from "./visual-file-storage";
import { VisualFileCache } from "./visual-file-cache";
import { colors } from "../design/tokens";

export function VisualLibraryConflict({
  conflict,
}: {
  conflict: SyncConflict;
}) {
  const { session } = useAuth();
  return (
    <ScopedVisualConflict
      key={`${session?.user.id}:${conflict.id}`}
      conflict={conflict}
    />
  );
}
function ScopedVisualConflict({ conflict }: { conflict: SyncConflict }) {
  const { session } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    { syncNow } = useSync();
  const owner = session?.user.id,
    storeId = session?.stores[0]?.storeId;
  const allowed =
    !!owner &&
    storeId === conflict.storeId &&
    session?.stores[0]?.role === "MANAGER";
  const authority = useRef({ owner, storeId, allowed });
  authority.current = { owner, storeId, allowed };
  const canResolve = () =>
    authority.current.allowed &&
    authority.current.owner === owner &&
    authority.current.storeId === conflict.storeId;
  const repository = useMemo(
    () => new VisualConflictRepository(sqlite, digestVisualId),
    [sqlite],
  );
  const [review, setReview] =
    useState<Awaited<ReturnType<VisualConflictRepository["review"]>>>();
  const [decision, setDecision] = useState<"LOCAL" | "REMOTE" | null>(null);
  const [compared, setCompared] = useState(false),
    [extra, setExtra] = useState(false),
    [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const epoch = useRef(0),
    locked = useRef(false),
    abort = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      const run = ++epoch.current;
      setReview(undefined);
      setDecision(null);
      setCompared(false);
      setExtra(false);
      setRights(false);
      setError(undefined);
      setBusy(false);
      if (allowed && owner)
        void repository
          .review(conflict.storeId, conflict.id, owner)
          .then((r) => {
            if (epoch.current === run) setReview(r);
          })
          .catch(() => {
            if (epoch.current === run)
              setError(
                "Cette comparaison n’est plus disponible. Synchronisez puis rouvrez le conflit ; vos choix restent conservés.",
              );
          });
      return () => {
        epoch.current++;
        abort.current?.abort();
      };
    }, [allowed, owner, repository, conflict.storeId, conflict.id]),
  );
  const needsExtra =
    decision === "LOCAL"
      ? review?.reactivateLocal
      : decision === "REMOTE"
        ? review?.reactivateRemote
        : false;
  const needsRights =
    decision === "LOCAL" &&
    review &&
    "provenance" in review.current.entity &&
    review.current.entity.provenance.type === "USER_UPLOAD";
  const enabled =
    !!decision &&
    compared &&
    (!needsExtra || extra) &&
    (!needsRights || rights) &&
    !busy;
  async function confirm() {
    if (!enabled || !review || !owner || locked.current || !canResolve())
      return;
    const run = epoch.current,
      cancel = new AbortController();
    locked.current = true;
    abort.current = cancel;
    setBusy(true);
    setError(undefined);
    try {
      await repository.resolve(
        conflict.storeId,
        conflict.id,
        decision === "LOCAL",
        {
          actorId: owner,
          deviceId,
          commandId: randomUUID(),
          reviewHash: review.hash,
          reactivate: extra,
          rightsConfirmed: rights,
          canResolve,
          signal: cancel.signal,
        },
      );
      if (epoch.current === run && canResolve()) {
        void syncNow(conflict.storeId).catch(() => undefined);
        router.back();
      }
    } catch {
      if (epoch.current === run) {
        setDecision(null);
        setCompared(false);
        setExtra(false);
        setRights(false);
        setError(
          "Le choix n’a pas été enregistré : la comparaison ou les droits ont changé. Relisez les versions avant de confirmer.",
        );
        const next = await repository
          .review(conflict.storeId, conflict.id, owner)
          .catch(() => undefined);
        if (epoch.current === run) setReview(next);
      }
    } finally {
      locked.current = false;
      if (abort.current === cancel) abort.current = null;
      if (epoch.current === run) setBusy(false);
    }
  }
  if (!allowed)
    return (
      <InlineAlert
        title="Droits nécessaires"
        message="Un responsable connecté à ce magasin doit comparer les versions. Les sources restent conservées."
      />
    );
  return (
    <View className="gap-4">
      {!review && !error ? (
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
          <Text className="text-base text-muted">
            Le choix remplace uniquement cette version. Les originaux et
            l’historique restent conservés.
          </Text>
          <SecondaryButton
            label={
              decision === "LOCAL" ? "✓ Garder mon choix" : "Garder mon choix"
            }
            disabled={busy || !review.canKeep}
            onPress={() => {
              setDecision("LOCAL");
              setCompared(false);
              setExtra(false);
              setRights(false);
            }}
          />
          <SecondaryButton
            label={
              decision === "REMOTE"
                ? "✓ Garder le choix synchronisé"
                : "Garder le choix synchronisé"
            }
            disabled={busy || !review.canAdopt}
            onPress={() => {
              setDecision("REMOTE");
              setCompared(false);
              setExtra(false);
              setRights(false);
            }}
          />
          {needsExtra ? (
            <Check
              checked={extra}
              disabled={busy}
              label="Je confirme explicitement la remise en diffusion de cet élément retiré ou supprimé."
              onPress={() => setExtra(!extra)}
            />
          ) : null}
          {needsRights ? (
            <Check
              checked={rights}
              disabled={busy}
              label="Je confirme disposer des droits d’utilisation de cette photo."
              onPress={() => setRights(!rights)}
            />
          ) : null}
          <Check
            checked={compared}
            disabled={busy || !decision}
            label="J’ai comparé les deux versions et je confirme mon choix."
            onPress={() => setCompared(!compared)}
          />
          <PrimaryButton
            label={busy ? "Enregistrement…" : "Confirmer cette résolution"}
            disabled={!enabled}
            onPress={() => void confirm()}
          />
        </>
      ) : null}
      {error ? (
        <InlineAlert title="Comparaison à reprendre" message={error} />
      ) : null}
    </View>
  );
}
function Check({
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
function VisualVersion({
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
