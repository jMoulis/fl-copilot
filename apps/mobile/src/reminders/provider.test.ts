import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reminderFixture } from "../../../../scripts/test-reminder-fixtures";
import { reminderFingerprint } from "@fl-copilot/domain";
import { ReminderProvider, useReminders } from "./provider";

type Response = { notification: { request: { content: { data: unknown } } } };
type ResponseListener = (response: Response) => void;
const runtime = vi.hoisted(() => ({
  storeId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  status: "authenticated",
  ownerId: "33333333-3333-4333-8333-333333333333",
  list: vi.fn(),
  preferences: vi.fn(),
  setStatus: vi.fn(),
  module: vi.fn(),
  adapter: vi.fn(),
  push: vi.fn(),
  syncNow: vi.fn(),
  handler: vi.fn(),
  onCommit: vi.fn(),
  add: vi.fn(),
  clear: vi.fn(),
  lastResponse: undefined as Response | undefined,
  responseListeners: new Set<ResponseListener>(),
  reminderListeners: new Set<() => void>(),
  outboxListeners: new Set<() => void>(),
  stateListeners: new Set<(state: string) => void>(),
  sqlite: { getAllAsync: vi.fn() },
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      runtime.stateListeners.add(listener);
      return { remove: () => runtime.stateListeners.delete(listener) };
    },
  },
}));
vi.mock("expo-router", () => ({
  router: { push: runtime.push },
  useRootNavigationState: () => ({ key: "root" }),
}));
vi.mock("expo-crypto", () => ({
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({
    status: runtime.status,
    session: runtime.storeId
      ? {
          stores: [{ storeId: runtime.storeId }],
          user: { id: runtime.ownerId },
        }
      : undefined,
  }),
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({ lastSyncedAt: undefined, syncNow: runtime.syncNow }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("@/sync/outbox-repository", () => ({
  subscribeOutboxChanges: (listener: () => void) => {
    runtime.outboxListeners.add(listener);
    return () => runtime.outboxListeners.delete(listener);
  },
}));
vi.mock("@/commercial/week-plan-context", () => ({
  readWeekPlanContext: vi.fn(),
}));
vi.mock("./repository", () => ({
  ReminderRepository: class {
    list = runtime.list;
    preferences = runtime.preferences;
    setStatus = runtime.setStatus;
  },
  subscribeReminders: (listener: () => void) => {
    runtime.reminderListeners.add(listener);
    return () => runtime.reminderListeners.delete(listener);
  },
}));
vi.mock("./native", () => ({
  notificationsAvailable: () => true,
  notificationModule: runtime.module,
  notificationAdapter: runtime.adapter,
}));
const native = {
  setNotificationHandler: runtime.handler,
  getLastNotificationResponse: () => runtime.lastResponse,
  clearLastNotificationResponse: runtime.clear,
  addNotificationResponseReceivedListener: runtime.add,
};
let rendered: ReactTestRenderer | undefined;
let observed: ReturnType<typeof useReminders>;
function Probe() {
  observed = useReminders();
  useLayoutEffect(() => {
    runtime.onCommit();
  });
  return null;
}
async function render() {
  await act(async () => {
    const node = createElement(ReminderProvider, {}, createElement(Probe));
    if (rendered) rendered.update(node);
    else rendered = create(node);
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function notification() {
  const { reminder } = await reminderFixture();
  runtime.storeId = reminder.storeId;
  return {
    reminder,
    data: {
      kind: "COMMERCIAL_REMINDER",
      reminderId: reminder.id,
      storeId: reminder.storeId,
      operationId: reminder.operationId,
      weekStart: reminder.weekStart,
      revisionId: reminder.planRevisionId,
      fingerprint: reminderFingerprint(reminder),
    },
  };
}
function response(data: unknown): Response {
  return { notification: { request: { content: { data } } } };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.storeId = "11111111-1111-4111-8111-111111111111";
  runtime.status = "authenticated";
  runtime.ownerId = "33333333-3333-4333-8333-333333333333";
  runtime.lastResponse = undefined;
  runtime.list.mockReset().mockResolvedValue([]);
  runtime.preferences.mockReset().mockResolvedValue(false);
  runtime.setStatus.mockReset().mockResolvedValue(undefined);
  runtime.module.mockReset().mockResolvedValue(native);
  runtime.adapter.mockReset().mockResolvedValue(null);
  runtime.push.mockReset();
  runtime.syncNow.mockReset().mockResolvedValue(undefined);
  runtime.handler.mockReset();
  runtime.onCommit.mockReset();
  runtime.add.mockReset().mockImplementation((listener: ResponseListener) => {
    runtime.responseListeners.add(listener);
    return { remove: () => runtime.responseListeners.delete(listener) };
  });
  runtime.clear.mockReset().mockImplementation(() => {
    runtime.lastResponse = undefined;
  });
});
afterEach(async () => {
  await act(async () => rendered?.unmount());
  rendered = undefined;
  runtime.responseListeners.clear();
  runtime.reminderListeners.clear();
  runtime.outboxListeners.clear();
  runtime.stateListeners.clear();
  vi.unstubAllGlobals();
});

it.each(["unmount", "store", "owner"])(
  "does not install a response listener after cold-start lookup outlives %s",
  async (change) => {
    const f = await notification(),
      module = deferred<typeof native>(),
      lookup = deferred<unknown[]>();
    runtime.module.mockReturnValueOnce(module.promise);
    runtime.lastResponse = response(f.data);
    await render();
    runtime.list.mockReturnValueOnce(lookup.promise);
    await act(async () => {
      module.resolve(native);
    });
    expect(runtime.responseListeners.size).toBe(0);
    if (change === "unmount") {
      await act(async () => rendered!.unmount());
      rendered = undefined;
    } else {
      if (change === "owner")
        runtime.ownerId = "44444444-4444-4444-8444-444444444444";
      else runtime.storeId = "22222222-2222-4222-8222-222222222222";
      await render();
    }
    await act(async () => {
      lookup.resolve([{ reminder: f.reminder }]);
    });
    expect(runtime.responseListeners.size).toBe(change === "unmount" ? 0 : 1);
    expect(runtime.push).not.toHaveBeenCalled();
    expect(runtime.syncNow).not.toHaveBeenCalled();
  },
);

it("retains one listener through 200 context replacements and removes all subscriptions on unmount", async () => {
  await render();
  const old = [...runtime.responseListeners][0]!;
  for (let i = 0; i < 200; i++) {
    runtime.storeId =
      i % 2
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222";
    await render();
    expect(runtime.responseListeners.size).toBe(1);
    expect(runtime.stateListeners.size).toBe(1);
    expect(runtime.reminderListeners.size).toBe(1);
    expect(runtime.outboxListeners.size).toBe(1);
  }
  await act(async () => {
    old(
      response({ kind: "COMMERCIAL_REMINDER_TEST", storeId: runtime.storeId }),
    );
  });
  expect(runtime.push).not.toHaveBeenCalled();
  await act(async () => rendered!.unmount());
  rendered = undefined;
  for (const listeners of [
    runtime.responseListeners,
    runtime.stateListeners,
    runtime.reminderListeners,
    runtime.outboxListeners,
  ])
    expect(listeners.size).toBe(0);
});

it("keeps foreground banners and sound scoped to the active authenticated store", async () => {
  const f = await notification();
  await render();
  const handler = runtime.handler.mock.lastCall![0] as {
    handleNotification(n: {
      request: { content: { data: unknown } };
    }): Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
    }>;
  };
  expect(
    await handler.handleNotification(response(f.data).notification),
  ).toMatchObject({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
  });
  expect(
    await handler.handleNotification(
      response({ ...f.data, storeId: "22222222-2222-4222-8222-222222222222" })
        .notification,
    ),
  ).toMatchObject({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
  });
  expect(
    await handler.handleNotification(
      response({ storeId: f.reminder.storeId }).notification,
    ),
  ).toMatchObject({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
  });
  expect(
    await handler.handleNotification(response(null).notification),
  ).toMatchObject({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
  });
  expect(
    await handler.handleNotification(
      response({
        kind: "COMMERCIAL_REMINDER_TEST",
        storeId: f.reminder.storeId,
      }).notification,
    ),
  ).toMatchObject({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
  });
  runtime.status = "unauthenticated";
  runtime.storeId = undefined;
  await render();
  expect(
    await handler.handleNotification(response(f.data).notification),
  ).toMatchObject({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
  });
});

it("does not report an old cold-start lookup failure in the next store", async () => {
  const f = await notification(),
    module = deferred<typeof native>(),
    lookup = deferred<unknown[]>();
  runtime.module.mockReturnValueOnce(module.promise);
  runtime.lastResponse = response(f.data);
  await render();
  runtime.list.mockReturnValueOnce(lookup.promise);
  await act(async () => {
    module.resolve(native);
  });
  runtime.storeId = "22222222-2222-4222-8222-222222222222";
  await render();
  await act(async () => {
    lookup.reject(Error("old database read failed"));
  });
  expect(observed.error).toBeUndefined();
  expect(runtime.responseListeners.size).toBe(1);
});

it("opens a current owned reminder from local data and qualifies a lookup failure without blaming the build", async () => {
  const f = await notification();
  await render();
  runtime.list.mockResolvedValueOnce([{ reminder: f.reminder }]);
  const listener = [...runtime.responseListeners][0]!;
  await act(async () => {
    listener(response(f.data));
  });
  expect(runtime.push).toHaveBeenCalledExactlyOnceWith({
    pathname: "/commercial-operation/[id]",
    params: {
      id: f.reminder.operationId,
      weekStart: f.reminder.weekStart,
      reminderRevision: f.reminder.planRevisionId,
    },
  });
  expect(runtime.syncNow).toHaveBeenCalledExactlyOnceWith(f.reminder.storeId);
  expect(runtime.clear).toHaveBeenCalledTimes(1);
  runtime.list.mockRejectedValueOnce(Error("database unavailable"));
  await act(async () => {
    listener(response(f.data));
  });
  expect(observed.error).toBe(
    "Le rappel ne peut pas être ouvert. Consultez votre plan de semaine.",
  );
  expect(runtime.push).toHaveBeenCalledTimes(1);
});

it("does not enter the native adapter or write statuses after an unmounted refresh finishes reading", async () => {
  const f = await notification(),
    lookup = deferred<unknown[]>();
  runtime.list.mockReturnValueOnce(lookup.promise);
  await render();
  await act(async () => rendered!.unmount());
  rendered = undefined;
  await act(async () => {
    lookup.resolve([{ reminder: f.reminder }]);
  });
  expect(runtime.adapter).not.toHaveBeenCalled();
  expect(runtime.setStatus).not.toHaveBeenCalled();
});

it("keeps receiving notifications after a current cold-start lookup fails", async () => {
  const f = await notification(),
    module = deferred<typeof native>(),
    lookup = deferred<unknown[]>();
  runtime.module.mockReturnValueOnce(module.promise);
  runtime.lastResponse = response(f.data);
  await render();
  runtime.list.mockReturnValueOnce(lookup.promise);
  await act(async () => {
    module.resolve(native);
  });
  await act(async () => {
    lookup.reject(Error("database unavailable"));
  });
  expect(observed.error).toBe(
    "Le rappel ne peut pas être ouvert. Consultez votre plan de semaine.",
  );
  expect(runtime.responseListeners.size).toBe(1);
  runtime.list.mockResolvedValueOnce([{ reminder: f.reminder }]);
  await act(async () => {
    [...runtime.responseListeners][0]!(response(f.data));
  });
  expect(runtime.push).toHaveBeenCalledTimes(1);
});

it("keeps local navigation usable when background synchronization rejects", async () => {
  const f = await notification();
  await render();
  runtime.list.mockResolvedValueOnce([{ reminder: f.reminder }]);
  runtime.syncNow.mockRejectedValueOnce(Error("network unavailable"));
  await act(async () => {
    [...runtime.responseListeners][0]!(response(f.data));
  });
  expect(runtime.push).toHaveBeenCalledTimes(1);
  expect(observed.error).toBe(
    "Le rappel est ouvert avec les données locales. L’actualisation n’a pas abouti ; réessayez depuis la synchronisation.",
  );
});

it("does not use a native adapter obtained after the provider is closed", async () => {
  const adapter = {
    permission: vi.fn(),
    pending: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
  };
  const loading = deferred<typeof adapter>();
  runtime.adapter.mockReturnValueOnce(loading.promise);
  await render();
  expect(runtime.adapter).toHaveBeenCalledTimes(1);
  await act(async () => rendered!.unmount());
  rendered = undefined;
  await act(async () => {
    loading.resolve(adapter);
  });
  expect(adapter.permission).not.toHaveBeenCalled();
  expect(adapter.pending).not.toHaveBeenCalled();
  expect(runtime.setStatus).not.toHaveBeenCalled();
});

it("silences the previous foreground handler at commit before passive listener cleanup", async () => {
  const f = await notification();
  await render();
  const handler = runtime.handler.mock.lastCall![0] as {
    handleNotification(n: {
      request: { content: { data: unknown } };
    }): Promise<{ shouldShowBanner: boolean; shouldPlaySound: boolean }>;
  };
  let duringCommit: ReturnType<typeof handler.handleNotification> | undefined;
  runtime.onCommit.mockImplementation(() => {
    duringCommit = handler.handleNotification(response(f.data).notification);
  });
  runtime.ownerId = "44444444-4444-4444-8444-444444444444";
  await render();
  expect(await duringCommit).toMatchObject({
    shouldShowBanner: false,
    shouldPlaySound: false,
  });
});
