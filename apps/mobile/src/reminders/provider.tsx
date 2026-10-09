import { CoalescedReminderRunner } from "./coalesced-runner";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { router, useRootNavigationState } from "expo-router";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import {
  commercialWeekPlanSchema,
  reminderNotificationDataSchema,
} from "@fl-copilot/domain";
import {
  commercialPlanNeedsReview,
  commercialExecutionPlanChecksum,
} from "@fl-copilot/commercial-core";
import { useAuth } from "@/auth/auth-provider";
import { useSync } from "@/sync/sync-provider";
import { useLocalDatabase } from "@/providers/database-provider";
import { subscribeOutboxChanges } from "@/sync/outbox-repository";
import { readWeekPlanContext } from "@/commercial/week-plan-context";
import { ReminderRepository, subscribeReminders } from "./repository";
import {
  notificationAdapter,
  notificationModule,
  notificationsAvailable,
} from "./native";
import { reconcileReminders } from "./reconcile";
const digest = (s: string) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, s);
const Context = createContext<{
  refresh(): Promise<void>;
  error: string | undefined;
  available: boolean;
} | null>(null);
export function ReminderProvider({ children }: PropsWithChildren) {
  const { session, status } = useAuth(),
    { lastSyncedAt, syncNow } = useSync(),
    { sqlite } = useLocalDatabase(),
    storeId = session?.stores[0]?.storeId;
  const root = useRootNavigationState(),
    active = useRef<string | undefined>(storeId),
    queue = useMemo(() => new CoalescedReminderRunner(), []),
    [error, setError] = useState<string>();
  const repo = useMemo(() => new ReminderRepository(sqlite, digest), [sqlite]);
  const refresh = useCallback(() => {
    const work = queue
      .run(async () => {
        if (status === "loading" || active.current !== storeId) return;
        const store = storeId,
          rows = store ? await repo.list(store) : [],
          enabled = store ? await repo.preferences(store) : false;
        const raw = store
          ? await sqlite.getAllAsync<{
              payload_json: string;
              sync_state: string;
            }>(
              "SELECT payload_json,sync_state FROM commercial_week_plans WHERE store_id=?",
              store,
            )
          : [];
        const plans = await Promise.all(
          raw.map(async (row) => {
            const p = commercialWeekPlanSchema.parse(
                JSON.parse(row.payload_json),
              ),
              ctx = await readWeekPlanContext(sqlite, p.preparation);
            return {
              id: p.id,
              revisionId: p.revisionId,
              checksum: await commercialExecutionPlanChecksum(p, digest),
              syncState: row.sync_state,
              needsReview: commercialPlanNeedsReview(p, ctx).length > 0,
              operations: p.operations,
            };
          }),
        );
        await reconcileReminders({
          storeId: store,
          enabled,
          reminders: rows.map((r) => r.reminder),
          plans,
          native: await notificationAdapter(),
          now: new Date(),
          isCurrent: () => active.current === store,
          status: (r, s, id) => repo.setStatus(r, s, id),
        });
        if (active.current === store) setError(undefined);
      })
      .catch(() =>
        setError(
          "Les rappels n’ont pas pu être vérifiés. Le plan reste utilisable ; réessayez depuis les réglages des rappels.",
        ),
      );
    return work;
  }, [repo, sqlite, status, storeId, queue]);
  useEffect(() => {
    active.current = storeId;
    void refresh();
    const unsubscribe = subscribeReminders(() => void refresh()),
      outbox = subscribeOutboxChanges(() => void refresh()),
      state = AppState.addEventListener("change", (s) => {
        if (s === "active") void refresh();
      });
    return () => {
      unsubscribe();
      outbox();
      state.remove();
    };
  }, [storeId, refresh]);
  useEffect(() => {
    if (lastSyncedAt) void refresh();
  }, [lastSyncedAt, refresh]);
  useEffect(() => {
    if (status !== "authenticated" || !storeId || !root?.key) return;
    let alive = true,
      remove: (() => void) | undefined;
    void notificationModule()
      .then(async (n) => {
        if (!n || !alive) return;
        n.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
        const handle = async (data: unknown) => {
          if (!alive || active.current !== storeId) return;
          if (
            typeof data === "object" &&
            data !== null &&
            "kind" in data &&
            data.kind === "COMMERCIAL_REMINDER_TEST" &&
            "storeId" in data &&
            data.storeId === active.current
          ) {
            n.clearLastNotificationResponse();
            router.push("/reminder-settings");
            return;
          }
          const parsed = reminderNotificationDataSchema.safeParse(data);
          if (!parsed.success || parsed.data.storeId !== active.current) return;
          const local = (await repo.list(parsed.data.storeId)).find(
            (r) =>
              r.reminder.id === parsed.data.reminderId &&
              r.reminder.operationId === parsed.data.operationId &&
              r.reminder.weekStart === parsed.data.weekStart,
          );
          if (!alive || !local || active.current !== parsed.data.storeId)
            return;
          n.clearLastNotificationResponse();
          void syncNow(parsed.data.storeId);
          router.push({
            pathname: "/commercial-operation/[id]",
            params: {
              id: parsed.data.operationId,
              weekStart: parsed.data.weekStart,
              reminderRevision: parsed.data.revisionId,
            },
          });
        };
        const response = n.getLastNotificationResponse();
        if (response) await handle(response.notification.request.content.data);
        const subscription = n.addNotificationResponseReceivedListener(
          (res) => {
            void handle(res.notification.request.content.data).catch(() =>
              setError(
                "Le rappel ne peut pas être ouvert. Consultez votre plan de semaine.",
              ),
            );
          },
        );
        remove = () => subscription.remove();
      })
      .catch(() =>
        setError("Les notifications ne sont pas disponibles dans ce build."),
      );
    return () => {
      alive = false;
      remove?.();
    };
  }, [repo, status, storeId, root?.key, syncNow]);
  return (
    <Context.Provider
      value={{ refresh, error, available: notificationsAvailable() }}
    >
      {children}
    </Context.Provider>
  );
}
export function useReminders() {
  const v = useContext(Context);
  if (!v) throw Error("ReminderProvider absent");
  return v;
}
