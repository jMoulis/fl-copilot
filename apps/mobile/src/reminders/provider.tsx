import { copilotCompletionNotificationSchema } from "@fl-copilot/sync-contracts";
import { chatNotificationDestination } from "../notifications/chat-destination";
import { CoalescedReminderRunner } from "./coalesced-runner";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  const context = useMemo(
    () => ({ storeId, status, ownerId: session?.user.id, sqlite }),
    [storeId, status, session?.user.id, sqlite],
  );
  const root = useRootNavigationState(),
    active = useRef<typeof context | undefined>(context),
    queue = useMemo(() => new CoalescedReminderRunner(), []),
    [error, setError] = useState<string>();
  const repo = useMemo(() => new ReminderRepository(sqlite, digest), [sqlite]);
  const refresh = useCallback(
    () =>
      queue.run(async () => {
        if (status === "loading" || active.current !== context) return;
        try {
          const store = storeId,
            rows = store ? await repo.list(store) : [],
            enabled = store ? await repo.preferences(store) : false;
          const planIds = enabled
            ? [
                ...new Set(
                  rows
                    .filter(
                      (r) =>
                        r.reminder.enabled &&
                        r.reminder.fireAt > new Date().toISOString(),
                    )
                    .map((r) => r.reminder.planId),
                ),
              ]
            : [];
          const raw =
            store && planIds.length
              ? await sqlite.getAllAsync<{
                  payload_json: string;
                  sync_state: string;
                }>(
                  `SELECT payload_json,sync_state FROM commercial_week_plans WHERE store_id=? AND id IN (${planIds.map(() => "?").join(",")})`,
                  store,
                  ...planIds,
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
          if (active.current !== context) return;
          const native = await notificationAdapter();
          if (active.current !== context) return;
          await reconcileReminders({
            storeId: store,
            enabled,
            reminders: rows.map((r) => r.reminder),
            plans,
            native,
            now: new Date(),
            isCurrent: () => active.current === context,
            status: async (r, s, id) => {
              if (active.current === context) await repo.setStatus(r, s, id);
            },
          });
          if (active.current === context) setError(undefined);
        } catch {
          if (active.current === context)
            setError(
              "Les rappels n’ont pas pu être vérifiés. Le plan reste utilisable ; réessayez depuis les réglages des rappels.",
            );
        }
      }),
    [repo, sqlite, status, storeId, queue, context],
  );
  useLayoutEffect(() => {
    active.current = context;
    return () => {
      if (active.current === context) active.current = undefined;
    };
  }, [context]);
  useEffect(() => {
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
  }, [context, refresh]);
  useEffect(() => {
    if (lastSyncedAt) void refresh();
  }, [lastSyncedAt, refresh]);
  useEffect(() => {
    if (status !== "authenticated" || !storeId || !root?.key) return;
    let alive = true,
      remove: (() => void) | undefined,
      lastChatReply: string | undefined,
      chatRevision = 0;
    void notificationModule()
      .then(async (n) => {
        if (!n || !alive) return;
        n.setNotificationHandler({
          handleNotification: async (notification) => {
            const data = notification.request.content.data;
            const visible =
              alive &&
              active.current === context &&
              data?.storeId === storeId &&
              (data?.kind === "COMMERCIAL_REMINDER_TEST" ||
                reminderNotificationDataSchema.safeParse(data).success);
            return {
              shouldPlaySound: visible,
              shouldSetBadge: false,
              shouldShowBanner: visible,
              shouldShowList: visible,
            };
          },
        });
        const handle = async (data: unknown) => {
          if (!alive || active.current !== context) return;
          if (
            typeof data === "object" &&
            data !== null &&
            "kind" in data &&
            data.kind === "COMMERCIAL_REMINDER_TEST" &&
            "storeId" in data &&
            data.storeId === storeId
          ) {
            n.clearLastNotificationResponse();
            router.push("/reminder-settings");
            return;
          }
          const chat = copilotCompletionNotificationSchema.safeParse(data);
          if (chat.success) {
            if (
              !context.ownerId ||
              chat.data.ownerId !== context.ownerId ||
              chat.data.storeId !== storeId
            )
              return;
            if (lastChatReply === chat.data.replyId) return;
            lastChatReply = chat.data.replyId;
            const revision = ++chatRevision;
            const readDestination = () =>
              chatNotificationDestination(
                sqlite,
                { ownerId: context.ownerId!, storeId: storeId! },
                chat.data,
              );
            let destination = await readDestination();
            if (
              !destination &&
              alive &&
              active.current === context &&
              revision === chatRevision
            ) {
              await syncNow(storeId!).catch(() => undefined);
              if (
                !alive ||
                active.current !== context ||
                revision !== chatRevision
              )
                return;
              destination = await readDestination();
            }
            if (
              !alive ||
              active.current !== context ||
              revision !== chatRevision
            )
              return;
            n.clearLastNotificationResponse();
            if (destination) router.push(destination);
            else
              setError(
                "Cette réponse n’est pas accessible. Ouvre tes conversations après synchronisation.",
              );
            return;
          }
          const parsed = reminderNotificationDataSchema.safeParse(data);
          if (!parsed.success || parsed.data.storeId !== storeId) return;
          const local = (await repo.list(parsed.data.storeId)).find(
            (r) =>
              r.reminder.id === parsed.data.reminderId &&
              r.reminder.operationId === parsed.data.operationId &&
              r.reminder.weekStart === parsed.data.weekStart,
          );
          if (!alive || !local || active.current !== context) return;
          n.clearLastNotificationResponse();
          void syncNow(parsed.data.storeId).catch(() => {
            if (alive && active.current === context)
              setError(
                "Le rappel est ouvert avec les données locales. L’actualisation n’a pas abouti ; réessayez depuis la synchronisation.",
              );
          });
          router.push({
            pathname: "/commercial-operation/[id]",
            params: {
              id: parsed.data.operationId,
              weekStart: parsed.data.weekStart,
              reminderRevision: parsed.data.revisionId,
            },
          });
        };
        const receive = async (data: unknown) => {
          try {
            await handle(data);
          } catch {
            if (alive && active.current === context)
              setError(
                "Le rappel ne peut pas être ouvert. Consultez votre plan de semaine.",
              );
          }
        };
        const response = n.getLastNotificationResponse();
        if (response) await receive(response.notification.request.content.data);
        if (!alive || active.current !== context) return;
        const subscription = n.addNotificationResponseReceivedListener(
          (res) => {
            void receive(res.notification.request.content.data);
          },
        );
        remove = () => subscription.remove();
      })
      .catch(() => {
        if (alive && active.current === context)
          setError("Les notifications ne sont pas disponibles dans ce build.");
      });
    return () => {
      alive = false;
      remove?.();
    };
  }, [repo, sqlite, status, storeId, root?.key, syncNow, context]);
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
