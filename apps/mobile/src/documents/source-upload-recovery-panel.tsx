import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { InlineAlert, SecondaryButton, SectionCard } from "../components/ui";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  SourceUploadRecoveryRepository,
  type UploadIntakeScope,
} from "./source-upload-recovery";
const digest = (text: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
type Page = Awaited<ReturnType<SourceUploadRecoveryRepository["list"]>>;
/** Same local task and guards in Synchronisation and the chat's file sheet. */
export function SourceUploadRecoveryPanel({
  db,
  storeId,
  scope,
  canRetry,
  sync,
  refreshKey,
  disabled = false,
  onBusyChange,
}: {
  db: OutboxDatabase & AtomicMutationDatabase;
  storeId: string;
  scope?: UploadIntakeScope;
  canRetry: boolean;
  sync(): Promise<unknown>;
  refreshKey?: unknown;
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const ownerId = scope?.ownerId,
    conversationId = scope?.conversationId;
  const repo = useMemo(
    () => new SourceUploadRecoveryRepository(db, digest),
    [db],
  );
  const [page, setPage] = useState<Page>(),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [busy, setBusy] = useState(false);
  const revision = useRef(0),
    locked = useRef(false),
    focused = useRef(false),
    abort = useRef<AbortController | undefined>(undefined),
    allowed = useRef(canRetry);
  allowed.current = canRetry;
  const load = useCallback(
    async (version: number, after?: Page["cursor"]) => {
      const next = await repo.list(
        storeId,
        ownerId && conversationId ? { ownerId, conversationId } : undefined,
        after,
      );
      if (revision.current === version)
        setPage((old) =>
          after
            ? { ...next, items: [...(old?.items ?? []), ...next.items] }
            : next,
        );
    },
    [repo, storeId, ownerId, conversationId],
  );
  useFocusEffect(
    useCallback(() => {
      // Refresh when the parent reports a new synchronization/import state.
      void refreshKey;
      focused.current = true;
      if (!locked.current) setBusy(false);
      const version = ++revision.current;
      setPage(undefined);
      setError(undefined);
      setNotice(undefined);
      void load(version).catch(() => {
        if (revision.current === version)
          setError(
            "Les envois ne peuvent pas être relus. Les originaux restent conservés ; réessayez.",
          );
      });
      return () => {
        focused.current = false;
        revision.current++;
        abort.current?.abort();
      };
    }, [load, refreshKey]),
  );
  const run = async (
    task: (version: number, signal: AbortSignal) => Promise<void>,
  ) => {
    if (locked.current || disabled) return;
    const version = revision.current,
      cancellation = new AbortController();
    locked.current = true;
    abort.current = cancellation;
    setBusy(true);
    onBusyChange?.(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await task(version, cancellation.signal);
    } catch {
      if (revision.current === version) {
        setError(
          "La reprise n’a pas pu être confirmée. Relisez l’état actuel avant de réessayer ; aucune ligne n’a été republiée.",
        );
        await load(version).catch(() => undefined);
      }
    } finally {
      locked.current = false;
      onBusyChange?.(false);
      if (focused.current) setBusy(false);
    }
  };
  if (page?.items.length === 0 && !error) return null;
  if (!page && !error) return null;
  return (
    <SectionCard
      title="Envois de fichiers à suivre"
      description="L’envoi de l’original et la publication des lignes sont deux étapes distinctes."
    >
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-forest">
          {notice}
        </Text>
      ) : null}
      {error ? <InlineAlert title="État à relire" message={error} /> : null}
      {page?.items.map((item) => (
        <View
          key={item.sourceDocumentId}
          className="gap-2 border-t border-line pt-3"
        >
          <Text className="font-semibold text-ink">{item.filename}</Text>
          <Text className="text-sm text-muted">
            {item.reason ??
              (item.status === "RETRY"
                ? "L’envoi reprendra avec la connexion. Vous pouvez demander une tentative maintenant."
                : "Original enregistré sur cet appareil, en attente d’envoi.")}
          </Text>
          {item.code ? (
            <Text selectable className="text-sm text-muted">
              Code : {item.code}
            </Text>
          ) : null}
          {item.canRetry && canRetry ? (
            <SecondaryButton
              label="Réessayer cet envoi"
              disabled={busy || disabled}
              onPress={() =>
                void run(async (version, signal) => {
                  await repo.retry(
                    storeId,
                    item.sourceDocumentId,
                    item.basisHash,
                    { canRetry: () => allowed.current, signal },
                    ownerId && conversationId
                      ? { ownerId, conversationId }
                      : undefined,
                  );
                  if (revision.current !== version) return;
                  setNotice(
                    "Reprise enregistrée. La réception du fichier reste à confirmer ; aucune ligne n’est republiée par ce bouton.",
                  );
                  await sync();
                  await load(version);
                })
              }
            />
          ) : null}
        </View>
      ))}
      <SecondaryButton
        label="Actualiser les envois"
        disabled={busy || disabled}
        onPress={() => void run(async (version) => load(version))}
      />
      {page?.hasMore ? (
        <SecondaryButton
          label="Afficher les envois suivants"
          disabled={busy || disabled}
          onPress={() =>
            void run(async (version) => load(version, page.cursor))
          }
        />
      ) : null}
    </SectionCard>
  );
}
