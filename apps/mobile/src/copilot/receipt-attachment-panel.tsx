import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { useSync } from "../sync/sync-provider";
import { InlineAlert, SecondaryButton } from "../components/ui";
import {
  WasteReceiptRepository,
  type LocalWasteReceiptSummary,
} from "../documents/waste-receipt-repository";
import { receiptProcessingPresentation } from "../documents/waste-receipt-processing";
export function ReceiptAttachmentPanel({
  sourceDocumentId,
}: {
  sourceDocumentId: string;
}) {
  const { session } = useAuth(),
    { sqlite } = useLocalDatabase(),
    sync = useSync(),
    router = useRouter();
  const storeId = session?.stores[0]?.storeId;
  const repo = useMemo(() => new WasteReceiptRepository(sqlite), [sqlite]);
  const [summary, setSummary] = useState<LocalWasteReceiptSummary | null>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const revision = useRef(0),
    locked = useRef(false),
    focused = useRef(false);
  const readLocal = useCallback(async () => {
    if (!storeId || !focused.current) return;
    const version = revision.current;
    try {
      const next = await repo.sourceSummary(storeId, sourceDocumentId);
      if (revision.current === version && focused.current) {
        setSummary(next);
        setError(undefined);
      }
    } catch {
      if (revision.current === version && focused.current)
        setError("Le suivi local du ticket ne peut pas être lu.");
    }
  }, [repo, storeId, sourceDocumentId]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      revision.current++;
      if (!locked.current) setBusy(false);
      void readLocal();
      return () => {
        focused.current = false;
        revision.current++;
      };
    }, [readLocal]),
  );
  useEffect(() => {
    if (sync.lastSyncedAt && focused.current) void readLocal();
  }, [readLocal, sync.lastSyncedAt]);
  const refresh = async () => {
    if (locked.current || !storeId) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const version = revision.current;
    try {
      await sync.syncNow(storeId);
      const next = await repo.sourceSummary(storeId, sourceDocumentId);
      if (revision.current === version) setSummary(next);
    } catch {
      if (revision.current === version)
        setError(
          "Le suivi n’a pas pu être actualisé. La photo et les corrections restent conservées.",
        );
    } finally {
      locked.current = false;
      if (focused.current) setBusy(false);
    }
  };
  const state = summary
    ? receiptProcessingPresentation(
        summary.receipt,
        summary.uploadJob,
        summary.lineCount,
        sync.status === "offline",
      )
    : null;
  return (
    <View className="gap-2">
      {state ? (
        <>
          <Text className="text-sm font-semibold text-ink">
            {state.title}
            {summary?.lineCount ? ` · ${summary.lineCount} lignes` : ""}
          </Text>
          <Text className="text-sm text-muted">{state.message}</Text>
        </>
      ) : (
        <Text className="text-sm text-muted">
          Le suivi du ticket sera disponible après sa synchronisation sur cet
          appareil.
        </Text>
      )}
      <SecondaryButton
        label="Synchroniser et actualiser le suivi"
        disabled={busy}
        onPress={() => void refresh()}
      />
      {summary ? (
        <SecondaryButton
          label={
            summary.receipt.duplicateStatus === "POSSIBLE_DUPLICATE"
              ? "Examiner le doublon"
              : "Voir le ticket"
          }
          onPress={() => router.push(`/waste-receipt/${summary.receipt.id}`)}
        />
      ) : null}
      {error ? <InlineAlert title="Suivi du ticket" message={error} /> : null}
    </View>
  );
}
