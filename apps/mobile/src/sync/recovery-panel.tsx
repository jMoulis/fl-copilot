import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { useAuth } from "../auth/auth-provider";
import { useLocalDatabase } from "../providers/database-provider";
import { InlineAlert, SecondaryButton, SectionCard } from "../components/ui";
import { SourceUploadRecoveryPanel } from "../documents/source-upload-recovery-panel";
import { OutboxRepository, type OutboxDatabase } from "./outbox-repository";
import { syncFailurePresentation } from "./failure-presentation";
import { useSync } from "./sync-provider";
export function SyncRecoveryPanel() {
  const { sqlite } = useLocalDatabase(),
    { session } = useAuth(),
    { syncNow, status, lastSyncedAt, failedCount } = useSync();
  const store = session?.stores[0];
  if (!store || !session) return null;
  return (
    <View key={`${store.storeId}/${session.user.id}`} className="gap-6">
      <SourceUploadRecoveryPanel
        db={sqlite}
        storeId={store.storeId}
        canRetry={store.role === "MANAGER"}
        sync={() => syncNow(store.storeId)}
        refreshKey={`${status}/${lastSyncedAt}`}
        disabled={status === "syncing"}
      />
      <FailedCommands
        db={sqlite}
        storeId={store.storeId}
        ownerId={session.user.id}
        revision={`${status}/${lastSyncedAt}/${failedCount}`}
      />
    </View>
  );
}
function FailedCommands({
  db,
  storeId,
  ownerId,
  revision: refreshKey,
}: {
  db: OutboxDatabase;
  storeId: string;
  ownerId: string;
  revision: string;
}) {
  type Page = Awaited<ReturnType<OutboxRepository["listFailures"]>>;
  const [page, setPage] = useState<Page>(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    revision = useRef(0),
    locked = useRef(false),
    focused = useRef(false);
  const read = useCallback(
    async (version: number, after = 0) => {
      const next = await new OutboxRepository(db).listFailures(
        storeId,
        ownerId,
        after,
      );
      if (revision.current === version) {
        setPage((old) =>
          after
            ? { ...next, items: [...(old?.items ?? []), ...next.items] }
            : next,
        );
        setError(false);
      }
    },
    [db, storeId, ownerId],
  );
  useFocusEffect(
    useCallback(() => {
      // Refresh when the parent reports a new synchronization/import state.
      void refreshKey;
      focused.current = true;
      if (!locked.current) setBusy(false);
      const version = ++revision.current;
      setPage(undefined);
      setError(false);
      void read(version).catch(() => {
        if (revision.current === version) setError(true);
      });
      return () => {
        focused.current = false;
        revision.current++;
      };
    }, [read, refreshKey]),
  );
  const refresh = async (after = 0) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const version = revision.current;
    try {
      await read(version, after);
    } catch {
      if (revision.current === version) setError(true);
    } finally {
      locked.current = false;
      if (focused.current) setBusy(false);
    }
  };
  if (!error && !page?.items.length) return null;
  return (
    <SectionCard title="Modifications refusées">
      {error ? (
        <InlineAlert
          title="Lecture impossible"
          message="Le détail des refus n’a pas pu être relu. Vos modifications restent conservées."
        />
      ) : null}
      {page?.items.map((item) => {
        const presentation = syncFailurePresentation(
          item.entityType,
          item.code,
        );
        const target = examinationTarget(item.entityType);
        return (
          <View
            key={item.commandId}
            className="gap-2 border-t border-line pt-3"
          >
            <Text className="font-semibold text-ink">{presentation.label}</Text>
            <Text className="text-sm text-muted">{presentation.message}</Text>
            {item.code ? (
              <Text selectable className="text-sm text-muted">
                Code : {item.code}
              </Text>
            ) : null}
            <Text selectable className="text-sm text-muted">
              Référence : {item.commandId}
            </Text>
            {target ? (
              <SecondaryButton
                label={target.label}
                onPress={() => router.push(target.path as Href)}
              />
            ) : null}
          </View>
        );
      })}
      <SecondaryButton
        label="Actualiser les refus"
        disabled={busy}
        onPress={() => void refresh()}
      />
      {page?.hasMore ? (
        <SecondaryButton
          label="Afficher les refus suivants"
          disabled={busy}
          onPress={() => void refresh(page.items.at(-1)?.localSequence)}
        />
      ) : null}
    </SectionCard>
  );
}
function examinationTarget(type: string) {
  if (["product", "product_identifier", "product_alias"].includes(type))
    return { label: "Examiner le référentiel", path: "/(tabs)/products" };
  if (type === "mercalys_publication")
    return { label: "Examiner les imports", path: "/(tabs)/imports" };
  if (type === "waste_receipt_publication")
    return { label: "Examiner les tickets", path: "/(tabs)/waste" };
  if (type.startsWith("commercial_"))
    return { label: "Examiner Ma semaine", path: "/(tabs)/week" };
  return null;
}
