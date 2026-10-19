import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect, router } from "expo-router";
import { useAuth } from "@/auth/auth-provider";
import { AppHeader, AppScreen, InlineAlert } from "@/components/ui";
import {
  WasteReceiptRepository,
  type LocalWasteReceiptSummary,
} from "@/documents/waste-receipt-repository";
import { ReceiptList } from "@/documents/receipt-list";
import { useLocalDatabase } from "@/providers/database-provider";
import { useSync } from "@/sync/sync-provider";
export default function WasteScreen() {
  const { session } = useAuth(),
    storeId = session?.stores[0]?.storeId,
    ownerId = session?.user.id;
  return storeId && ownerId ? (
    <StoreWaste key={`${storeId}:${ownerId}`} storeId={storeId} />
  ) : (
    <AppScreen>
      <AppHeader title="Casse" />
      <InlineAlert
        title="Aucun magasin actif"
        message="Reconnectez-vous pour retrouver les tickets de votre magasin."
      />
    </AppScreen>
  );
}
function StoreWaste({ storeId }: { storeId: string }) {
  const { sqlite } = useLocalDatabase(),
    sync = useSync();
  const repository = useMemo(
    () => new WasteReceiptRepository(sqlite),
    [sqlite],
  );
  const [receipts, setReceipts] = useState<LocalWasteReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<string>();
  const generation = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const rows = await repository.listReceipts(storeId);
      if (ticket === generation.current) {
        setReceipts(rows);
        setError(undefined);
      }
    } catch {
      if (ticket === generation.current)
        setError(
          "Les tickets n’ont pas pu être relus. Les données déjà affichées restent conservées.",
        );
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [repository, storeId]);
  const needsRefresh = receipts.some(
    (r) =>
      r.uploadJob &&
      ["PENDING", "RETRY", "RUNNING"].includes(r.uploadJob.status),
  );
  useFocusEffect(
    useCallback(() => {
      if (sync.status === "syncing") return;
      void load();
      const timer = needsRefresh
        ? setInterval(() => void load(), 2000)
        : undefined;
      return () => {
        generation.current++;
        if (timer) clearInterval(timer);
      };
    }, [load, needsRefresh, sync.status]),
  );
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <ReceiptList
      receipts={receipts}
      loading={loading}
      refreshing={refreshing}
      error={error}
      offline={sync.status === "offline"}
      onRefresh={() => void refresh()}
      onCapture={() => router.push("/waste-capture")}
      onImport={() => router.push("/waste-import")}
      onOpen={(id) => router.push(`/waste-receipt/${id}`)}
      onSync={() => router.push("/sync-center")}
    />
  );
}
