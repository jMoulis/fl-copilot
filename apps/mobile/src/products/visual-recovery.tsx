import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { VisualEntityType } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { InlineAlert, PrimaryButton, SecondaryButton } from "../components/ui";
import {
  VisualRecoveryRepository,
  type VisualRecoveryAction,
} from "./visual-recovery-repository";
import { digestVisualId } from "./visual-id-digest";
import { VisualReviewCheck, VisualVersion } from "./visual-conflict";
import { syncFailurePresentation } from "../sync/failure-presentation";

export function VisualRecoveryForm(props: {
  kind: VisualEntityType;
  id: string;
  onRecovered(): void;
}) {
  const { session } = useAuth();
  return (
    <ScopedRecovery
      key={`${session?.user.id}:${session?.stores[0]?.storeId}:${props.kind}:${props.id}`}
      {...props}
    />
  );
}
function ScopedRecovery({
  kind,
  id,
  onRecovered,
}: {
  kind: VisualEntityType;
  id: string;
  onRecovered(): void;
}) {
  const { session } = useAuth(),
    { sqlite, deviceId } = useLocalDatabase(),
    sync = useSync();
  const owner = session?.user.id,
    store = session?.stores[0],
    storeId = store?.storeId;
  const allowed = !!owner && !!storeId && store?.role === "MANAGER";
  const authority = useRef({ owner, storeId, allowed });
  authority.current = { owner, storeId, allowed };
  const canWrite = () =>
    authority.current.allowed &&
    authority.current.owner === owner &&
    authority.current.storeId === storeId;
  const repo = useMemo(
    () => new VisualRecoveryRepository(sqlite, digestVisualId),
    [sqlite],
  );
  const [review, setReview] =
    useState<Awaited<ReturnType<VisualRecoveryRepository["review"]>>>();
  const [action, setAction] = useState<VisualRecoveryAction | null>(null),
    [checked, setChecked] = useState(false),
    [extra, setExtra] = useState(false),
    [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [complete, setComplete] = useState(false);
  const epoch = useRef(0),
    lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      const run = ++epoch.current;
      setReview(undefined);
      setAction(null);
      setChecked(false);
      setExtra(false);
      setRights(false);
      setError(undefined);
      setBusy(false);
      setComplete(false);
      if (allowed && storeId && owner)
        void repo
          .review(storeId, kind, id, owner)
          .then((r) => {
            if (epoch.current === run) setReview(r);
          })
          .catch(() => {
            if (epoch.current === run)
              setError(
                "Cette modification a changé ou n’est plus en erreur. Actualisez la synchronisation puis rouvrez-la.",
              );
          });
      return () => {
        epoch.current++;
        abort.current?.abort();
      };
    }, [repo, storeId, owner, allowed, kind, id]),
  );
  const needsExtra =
    action === "RETRY_LOCAL"
      ? review?.retryReactivates
      : action === "ADOPT_REMOTE"
        ? review?.adoptReactivates
        : false;
  const needsRights =
    action === "RETRY_LOCAL" &&
    review &&
    !review.current.entity.deletedAt &&
    "provenance" in review.current.entity &&
    review.current.entity.provenance.type === "USER_UPLOAD";
  const enabled =
    !!review &&
    !!action &&
    checked &&
    (!needsExtra || extra) &&
    (!needsRights || rights) &&
    !busy &&
    !complete;
  function choose(next: VisualRecoveryAction) {
    setAction(next);
    setChecked(false);
    setExtra(false);
    setRights(false);
  }
  async function confirm() {
    if (
      !enabled ||
      !review ||
      !action ||
      !storeId ||
      !owner ||
      lock.current ||
      !canWrite()
    )
      return;
    const run = epoch.current,
      cancel = new AbortController();
    let committed = false;
    lock.current = true;
    abort.current = cancel;
    setBusy(true);
    setError(undefined);
    try {
      await repo.recover(storeId, kind, id, action, {
        actorId: owner,
        deviceId,
        commandId: randomUUID(),
        reviewHash: review.hash,
        reactivate: extra,
        rightsConfirmed: rights,
        canWrite,
        signal: cancel.signal,
      });
      committed = true;
      if (epoch.current === run && canWrite()) {
        setComplete(true);
        // Metadata is already committed. A file retry failing must not report that decision as lost.
        const fileChoice =
          action === "RETRY_LOCAL"
            ? review.current.entity
            : action === "ADOPT_REMOTE"
              ? review.remote
              : null;
        if (
          kind === "visual_asset" &&
          fileChoice &&
          !fileChoice.deletedAt &&
          "review" in fileChoice &&
          fileChoice.review.status === "APPROVED" &&
          sync.visuals
        )
          void sync.visuals.retry(id).catch(() => undefined);
        void sync.syncNow(storeId).catch(() => undefined);
        onRecovered();
      }
    } catch {
      if (committed) return; // A closing/navigation failure cannot undo the saved decision.
      if (epoch.current === run) {
        setAction(null);
        setChecked(false);
        setExtra(false);
        setRights(false);
        setError(
          "La reprise n’a pas été enregistrée. Relisez le choix et les droits ; la photo et la saisie précédente restent conservées.",
        );
        const next = await repo
          .review(storeId, kind, id, owner)
          .catch(() => undefined);
        if (epoch.current === run) setReview(next);
      }
    } finally {
      lock.current = false;
      if (abort.current === cancel) abort.current = null;
      if (epoch.current === run) setBusy(false);
    }
  }
  if (!allowed)
    return (
      <InlineAlert
        title="Droits nécessaires"
        message="Un responsable doit être connecté à ce magasin pour reprendre l’enregistrement."
      />
    );
  return (
    <View className="gap-4">
      {!review && !error ? (
        <ActivityIndicator accessibilityLabel="Lecture du choix refusé" />
      ) : null}
      {complete ? (
        <InlineAlert
          title="Reprise enregistrée"
          message="Le choix est enregistré sur cet appareil. L’envoi reste suivi dans Synchronisation."
        />
      ) : null}
      {review && !complete ? (
        <>
          <InlineAlert
            title="Enregistrement refusé"
            message={
              syncFailurePresentation(
                kind,
                review.commands.filter((c) => c.status === "FAILED").at(-1)
                  ?.last_error_code ?? null,
              ).message
            }
          />
          <VisualVersion
            key={`${review.hash}:local`}
            title="Choix conservé sur cet appareil"
            entity={review.current.entity}
            labels={review.labels}
            preview={review.preview}
          />
          {review.remote ? (
            <VisualVersion
              key={`${review.hash}:remote`}
              title="Version connue à la dernière synchronisation"
              entity={review.remote}
              labels={review.labels}
              preview={"contentHash" in review.remote ? review.remote : null}
            />
          ) : null}
          <Text className="text-base text-muted">{review.reason}</Text>
          <SecondaryButton
            label={
              action === "RETRY_LOCAL"
                ? "✓ Retenter ce choix"
                : "Retenter ce choix"
            }
            disabled={busy || !review.canRetry}
            onPress={() => choose("RETRY_LOCAL")}
          />
          {review.canAdopt ? (
            <SecondaryButton
              label={
                action === "ADOPT_REMOTE"
                  ? "✓ Garder la version synchronisée connue"
                  : "Garder la version synchronisée connue"
              }
              disabled={busy}
              onPress={() => choose("ADOPT_REMOTE")}
            />
          ) : null}
          {kind === "product_visual_link" ? (
            <SecondaryButton
              label={
                action === "REMOVE_LINK"
                  ? "✓ Retirer cette association"
                  : "Retirer cette association"
              }
              disabled={busy || !review.canRemove}
              onPress={() => choose("REMOVE_LINK")}
            />
          ) : null}
          {review.canRetire ? (
            <SecondaryButton
              label={
                action === "RETIRE_LOCAL"
                  ? "✓ Retirer ce choix local"
                  : "Retirer ce choix local"
              }
              disabled={busy}
              onPress={() => choose("RETIRE_LOCAL")}
            />
          ) : null}
          {action === "REMOVE_LINK" || action === "RETIRE_LOCAL" ? (
            <Text className="text-base text-muted">
              Le produit et la photo sont conservés. Le retrait sera contrôlé
              par le serveur ; une version distante inconnue ne sera pas
              remplacée automatiquement.
            </Text>
          ) : null}
          {needsExtra ? (
            <VisualReviewCheck
              checked={extra}
              disabled={busy}
              label="Je confirme la remise en diffusion de cet élément retiré ou supprimé."
              onPress={() => setExtra(!extra)}
            />
          ) : null}
          {needsRights ? (
            <VisualReviewCheck
              checked={rights}
              disabled={busy}
              label="Je confirme disposer des droits d’utilisation de cette photo."
              onPress={() => setRights(!rights)}
            />
          ) : null}
          <VisualReviewCheck
            checked={checked}
            disabled={busy || !action}
            label="J’ai relu ce choix et je confirme cette reprise."
            onPress={() => setChecked(!checked)}
          />
          <PrimaryButton
            label={busy ? "Enregistrement…" : "Confirmer la reprise"}
            disabled={!enabled}
            onPress={() => void confirm()}
          />
        </>
      ) : null}
      {error ? (
        <InlineAlert title="Reprise à vérifier" message={error} />
      ) : null}
    </View>
  );
}
