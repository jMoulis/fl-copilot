import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import type { VisualEntityType } from "@fl-copilot/domain";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { InlineAlert } from "../components/ui";
import {
  VisualRecoveryRepository,
  type VisualRecoveryAction,
} from "./visual-recovery-repository";
import { digestVisualId } from "./visual-id-digest";
import {
  VisualRecoveryChoices,
  visualRecoverySelectionReady,
} from "./visual-recovery-choices";

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
  const enabled =
    !!review &&
    visualRecoverySelectionReady(review, {
      action,
      checked,
      reactivate: extra,
      rightsConfirmed: rights,
    }) &&
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
        <VisualRecoveryChoices
          review={review}
          selection={{
            action,
            checked,
            reactivate: extra,
            rightsConfirmed: rights,
          }}
          busy={busy}
          canConfirm={allowed}
          onAction={choose}
          onChecked={() => setChecked(!checked)}
          onReactivate={() => setExtra(!extra)}
          onRights={() => setRights(!rights)}
          onConfirm={() => void confirm()}
        />
      ) : null}
      {error ? (
        <InlineAlert title="Reprise à vérifier" message={error} />
      ) : null}
    </View>
  );
}
