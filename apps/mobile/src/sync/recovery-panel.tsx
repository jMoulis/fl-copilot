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
import { isVisualEntityType } from "@fl-copilot/domain";
import { z } from "zod";
import type { AtomicMutationDatabase } from "./atomic-local-mutation";
import { retryFailedAnalyticsJobs } from "../analytics/local-recomputation";
import { retireDeletedConversationEmailDecision } from "../intake/email-decision-repository";
export function SyncRecoveryPanel() {
  const { sqlite } = useLocalDatabase(),
    { session } = useAuth(),
    { syncNow, status, lastSyncedAt, failedCount, pendingDetails } = useSync();
  const focused = useRef(false),
    locked = useRef(false),
    authority = useRef({ sqlite, session });
  authority.current = { sqlite, session };
  const [retryError, setRetryError] = useState<string>(),
    [retryBusy, setRetryBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (!locked.current) setRetryBusy(false);
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const store = session?.stores[0];
  if (!store || !session) return null;
  const canWrite = () =>
    focused.current &&
    authority.current.sqlite === sqlite &&
    authority.current.session?.user.id === session.user.id &&
    authority.current.session?.stores.some(
      (s) => s.storeId === store.storeId,
    ) === true;
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
      {pendingDetails?.some(
        (item) => item.retryAction === "ANALYTICS_RECOMPUTE",
      ) ? (
        <SectionCard title="Reprendre le calcul local">
          <Text className="text-sm text-muted">
            Les sources et les chiffres déjà calculés sont conservés. Seuls les
            calculs locaux en échec seront relancés.
          </Text>
          <SecondaryButton
            label="Reprendre les calculs en échec"
            loading={retryBusy}
            disabled={retryBusy || status === "syncing"}
            onPress={() => {
              if (locked.current || !canWrite()) return;
              locked.current = true;
              setRetryBusy(true);
              setRetryError(undefined);
              void (async () => {
                try {
                  await retryFailedAnalyticsJobs(
                    sqlite,
                    store.storeId,
                    canWrite,
                  );
                  if (canWrite()) await syncNow(store.storeId);
                } catch {
                  if (canWrite())
                    setRetryError(
                      "La reprise n’a pas abouti. Les sources sont conservées ; consultez le code du calcul en échec.",
                    );
                } finally {
                  locked.current = false;
                  if (canWrite()) setRetryBusy(false);
                }
              })();
            }}
          />
          {retryError ? (
            <InlineAlert title="Calcul local" message={retryError} />
          ) : null}
        </SectionCard>
      ) : null}
      <FailedCommands
        db={sqlite}
        canWrite={canWrite}
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
  canWrite,
}: {
  db: OutboxDatabase & AtomicMutationDatabase;
  canWrite(): boolean;
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
  const actionContext = useRef({ db, storeId, ownerId, canWrite });
  actionContext.current = { db, storeId, ownerId, canWrite };
  const [actionError, setActionError] = useState<string>();
  const retire = async (commandId: string) => {
    if (locked.current || !focused.current || !canWrite()) return;
    locked.current = true;
    setBusy(true);
    setActionError(undefined);
    const captured = actionContext.current;
    const valid = () =>
      focused.current &&
      actionContext.current.db === captured.db &&
      actionContext.current.ownerId === captured.ownerId &&
      actionContext.current.storeId === captured.storeId &&
      actionContext.current.canWrite();
    try {
      await retireDeletedConversationEmailDecision(
        db,
        { storeId, ownerId },
        commandId,
        valid,
      );
      if (valid()) await read(revision.current);
    } catch {
      if (valid())
        setActionError(
          "L’envoi n’a pas été écarté. Relisez les refus ; la conversation doit être supprimée sur cet appareil et l’envoi doit toujours être refusé.",
        );
    } finally {
      locked.current = false;
      if (valid()) setBusy(false);
    }
  };
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
        const target =
          item.entityType === "email_intake_decision" &&
          !item.parentDeleted &&
          z.uuid().safeParse(item.conversationId).success
            ? {
                label: "Examiner l’email dans sa conversation",
                path: `/copilot?conversationId=${item.conversationId}`,
              }
            : examinationTarget(item.entityType, item.entityId);
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
            {item.entityType === "email_intake_decision" &&
            item.parentDeleted &&
            item.code === "COPILOT_HISTORY_ACCESS_INVALID" ? (
              <>
                <Text className="text-sm text-muted">
                  La conversation a été supprimée. Vous pouvez écarter cet
                  ancien envoi ; les originaux et l’historique restent
                  conservés.
                </Text>
                <SecondaryButton
                  label="Écarter cet ancien envoi"
                  disabled={busy}
                  onPress={() => void retire(item.commandId)}
                />
              </>
            ) : null}
            {target ? (
              <SecondaryButton
                label={target.label}
                onPress={() => router.push(target.path as Href)}
              />
            ) : null}
          </View>
        );
      })}
      {actionError ? (
        <InlineAlert title="Envoi conservé" message={actionError} />
      ) : null}
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
function examinationTarget(type: string, id: string) {
  if (isVisualEntityType(type) && z.uuid().safeParse(id).success)
    return {
      label: "Reprendre ce visuel",
      path: `/(tabs)/visual-recovery/${type}/${id}`,
    };
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
