import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import { TabRouter } from "expo-router/build/react-navigation/routers/TabRouter";
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
  role: "MANAGER",
  ownerId: "33333333-3333-4333-8333-333333333333",
  list: vi.fn(),
  preferences: vi.fn(),
  setStatus: vi.fn(),
  module: vi.fn(),
  adapter: vi.fn(),
  push: vi.fn(),
  navigate: vi.fn(),
  dismissTo: vi.fn(),
  rootState: {
    key: "root",
    index: 0,
    routes: [{ key: "tabs", name: "(tabs)" }],
  },
  syncNow: vi.fn(),
  syncMessages: undefined as ReturnType<typeof vi.fn> | undefined,
  handler: vi.fn(),
  onCommit: vi.fn(),
  add: vi.fn(),
  clear: vi.fn(),
  lastResponse: undefined as Response | undefined,
  responseListeners: new Set<ResponseListener>(),
  reminderListeners: new Set<() => void>(),
  outboxListeners: new Set<() => void>(),
  stateListeners: new Set<(state: string) => void>(),
  sqlite: { getAllAsync: vi.fn(), getFirstAsync: vi.fn() },
  destination: vi.fn(),
}));
vi.mock("../notifications/chat-destination", () => ({
  chatNotificationDestination: runtime.destination,
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
  router: {
    push: runtime.push,
    navigate: runtime.navigate,
    dismissTo: runtime.dismissTo,
  },
  useRootNavigationState: () => runtime.rootState,
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
          stores: [{ storeId: runtime.storeId, role: runtime.role }],
          user: { id: runtime.ownerId },
        }
      : undefined,
  }),
}));
vi.mock("@/sync/sync-provider", () => ({
  useSync: () => ({
    lastSyncedAt: undefined,
    syncNow: runtime.syncNow,
    syncMessages: runtime.syncMessages,
  }),
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
  runtime.navigate.mockReset();
  runtime.dismissTo.mockReset();
  runtime.rootState = {
    key: "root",
    index: 0,
    routes: [{ key: "tabs", name: "(tabs)" }],
  };
  runtime.sqlite.getFirstAsync.mockReset().mockResolvedValue(undefined);
  runtime.destination.mockReset().mockResolvedValue(undefined);
  runtime.syncNow.mockReset().mockResolvedValue(undefined);
  runtime.syncMessages = undefined;
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
  expect(runtime.navigate).toHaveBeenCalledExactlyOnceWith({
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
  expect(runtime.navigate).toHaveBeenCalledTimes(1);
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
  expect(runtime.navigate).toHaveBeenCalledTimes(1);
});

it("keeps local navigation usable when background synchronization rejects", async () => {
  const f = await notification();
  await render();
  runtime.list.mockResolvedValueOnce([{ reminder: f.reminder }]);
  runtime.syncNow.mockRejectedValueOnce(Error("network unavailable"));
  await act(async () => {
    [...runtime.responseListeners][0]!(response(f.data));
  });
  expect(runtime.navigate).toHaveBeenCalledTimes(1);
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

function chatData() {
  return {
    kind: "COPILOT_REPLY_READY",
    ownerId: runtime.ownerId,
    storeId: runtime.storeId,
    conversationId: "44444444-4444-4444-8444-444444444444",
    replyId: "55555555-5555-4555-8555-555555555555",
  };
}
it("opens a cached chat alert once without waiting for network or replaying generation", async () => {
  const data = chatData(),
    destination = {
      pathname: "/(tabs)/copilot",
      params: { conversationId: data.conversationId },
    };
  runtime.destination.mockResolvedValue(destination);
  runtime.lastResponse = response(data);
  await render();
  await act(async () => {
    for (const listener of runtime.responseListeners) listener(response(data));
  });
  expect(runtime.navigate).toHaveBeenCalledExactlyOnceWith(destination);
  expect(runtime.syncNow).not.toHaveBeenCalled();
});
it("pulls a missing chat result once before opening its fixed route", async () => {
  const data = chatData(),
    destination = {
      pathname: "/(tabs)/copilot",
      params: { conversationId: data.conversationId },
    };
  runtime.destination
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(destination);
  runtime.lastResponse = response(data);
  await render();
  expect(runtime.syncNow).toHaveBeenCalledTimes(1);
  expect(runtime.navigate).toHaveBeenCalledExactlyOnceWith(destination);
});
it("ignores foreign-owner push and cannot navigate after owner changes during pull", async () => {
  runtime.lastResponse = response({
    ...chatData(),
    ownerId: "66666666-6666-4666-8666-666666666666",
  });
  await render();
  expect(runtime.destination).not.toHaveBeenCalled();
  const pull = deferred<void>();
  runtime.syncNow.mockReturnValue(pull.promise);
  const oldListener = [...runtime.responseListeners][0]!;
  await act(async () => {
    oldListener(response(chatData()));
  });
  runtime.ownerId = "77777777-7777-4777-8777-777777777777";
  await render();
  await act(async () => {
    pull.resolve();
  });
  expect(runtime.push).not.toHaveBeenCalled();
  expect(runtime.navigate).not.toHaveBeenCalled();
  expect(runtime.dismissTo).not.toHaveBeenCalled();
});

it("opens a missing chat result through canonical sync without waiting for full file jobs", async () => {
  const data = chatData(),
    destination = {
      pathname: "/(tabs)/copilot",
      params: { conversationId: data.conversationId },
    };
  const files = deferred<void>();
  runtime.syncNow.mockReturnValue(files.promise);
  runtime.syncMessages = vi.fn().mockResolvedValue(undefined);
  runtime.destination
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(destination);
  runtime.lastResponse = response(data);
  await render();
  expect(runtime.syncMessages).toHaveBeenCalledExactlyOnceWith(data.storeId);
  expect(runtime.syncNow).not.toHaveBeenCalled();
  expect(runtime.navigate).toHaveBeenCalledExactlyOnceWith(destination);
  files.resolve();
});

it("reuses the existing chat route for successive reply notifications instead of stacking copies", async () => {
  const sdk = StackRouter({ initialRouteName: "index" });
  const options = {
    routeNames: ["index"],
    routeParamList: { index: undefined },
    routeGetIdList: { index: undefined },
  };
  let state = sdk.getInitialState(options);
  const originalKey = state.routes[0]!.key;
  type Destination = { params: { conversationId: string } };
  const apply = (type: "NAVIGATE" | "PUSH", destination: Destination) => {
    state = sdk.getStateForAction(
      state,
      { type, payload: { name: "index", params: destination.params } },
      options,
    )! as typeof state;
  };
  runtime.push.mockImplementation((destination) => apply("PUSH", destination));
  runtime.navigate.mockImplementation((destination) =>
    apply("NAVIGATE", destination),
  );
  runtime.destination.mockImplementation(async (_db, _scope, data) => ({
    pathname: "/(tabs)/copilot",
    params: { conversationId: data.conversationId },
  }));
  await render();
  const first = chatData();
  await act(async () => {
    for (const listener of runtime.responseListeners) listener(response(first));
  });
  expect(state.routes).toHaveLength(1);
  expect(state.routes[0]!.key).toBe(originalKey);
  const second = {
    ...first,
    replyId: "66666666-6666-4666-8666-666666666666",
    conversationId: "77777777-7777-4777-8777-777777777777",
  };
  await act(async () => {
    for (const listener of runtime.responseListeners)
      listener(response(second));
  });
  expect(state.routes).toHaveLength(1);
  expect(state.routes[0]).toMatchObject({
    key: originalKey,
    params: { conversationId: second.conversationId },
  });
  expect(runtime.push).not.toHaveBeenCalled();
});

it("selects the existing Copilote tab when another tab is active", async () => {
  const sdk = TabRouter({ initialRouteName: "analytics" });
  const options = {
    routeNames: ["analytics", "copilot"],
    routeParamList: {},
    routeGetIdList: {},
  };
  let state = sdk.getInitialState(options);
  const originalKey = state.routes[1]!.key;
  runtime.navigate.mockImplementation((destination) => {
    state = sdk.getStateForAction(
      state,
      {
        type: "NAVIGATE",
        payload: {
          name: "copilot",
          params: { screen: "index", params: destination.params },
        },
      },
      options,
    )! as typeof state;
  });
  const data = chatData();
  runtime.lastResponse = response(data);
  runtime.destination.mockResolvedValue({
    pathname: "/(tabs)/copilot",
    params: { conversationId: data.conversationId },
  });
  await render();
  expect(state.routes).toHaveLength(2);
  expect(state.index).toBe(1);
  expect(state.routes[1]!.key).toBe(originalKey);
  expect(runtime.push).not.toHaveBeenCalled();
});

it.each([true, false])(
  "returns through the root stack without adding a second tab container (existing=%s)",
  async (existing) => {
    const sdk = StackRouter({
      initialRouteName: existing ? "(tabs)" : "product/[id]",
    });
    const options = {
      routeNames: ["(tabs)", "product/[id]"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = sdk.getInitialState(options);
    const originalTabsKey = existing ? state.routes[0]!.key : undefined;
    if (existing)
      state = sdk.getStateForAction(
        state,
        {
          type: "PUSH",
          payload: { name: "product/[id]", params: { id: "product" } },
        },
        options,
      )! as typeof state;
    runtime.rootState = state;
    runtime.dismissTo.mockImplementation((destination) => {
      state = sdk.getStateForAction(
        state,
        {
          type: "POP_TO",
          payload: {
            name: "(tabs)",
            params: {
              screen: "copilot",
              params: { screen: "index", params: destination.params },
            },
          },
        },
        options,
      )! as typeof state;
    });
    const data = chatData();
    runtime.lastResponse = response(data);
    runtime.destination.mockResolvedValue({
      pathname: "/(tabs)/copilot",
      params: { conversationId: data.conversationId },
    });
    await render();
    expect(runtime.dismissTo).toHaveBeenCalledTimes(1);
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(runtime.push).not.toHaveBeenCalled();
    expect(state.routes).toHaveLength(1);
    expect(state.routes[0]!.name).toBe("(tabs)");
    if (existing) expect(state.routes[0]!.key).toBe(originalTabsKey);
    expect(state.routes[0]!.params).toMatchObject({
      screen: "copilot",
      params: {
        screen: "index",
        params: { conversationId: data.conversationId },
      },
    });
  },
);

it.each([
  "OPEN_TWICE",
  "ALREADY_OPEN",
  "TEST_ALREADY_OPEN",
  "BURIED_OPERATION",
  "BURIED_TEST",
])(
  "reuses the native reminder destination instead of stacking it: %s",
  async (mode) => {
    const f = await notification();
    const target = mode.includes("TEST")
      ? "reminder-settings"
      : "commercial-operation/[id]";
    const sdk = StackRouter({ initialRouteName: "(tabs)" });
    const options = {
      routeNames: ["(tabs)", target, "product/[id]"],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = sdk.getInitialState(options);
    const params = {
      id: f.reminder.operationId,
      weekStart: f.reminder.weekStart,
      reminderRevision: f.reminder.planRevisionId,
    };
    if (mode !== "OPEN_TWICE")
      state = sdk.getStateForAction(
        state,
        { type: "PUSH", payload: { name: target, params } },
        options,
      )! as typeof state;
    const originalKey = state.routes[1]?.key;
    if (mode.startsWith("BURIED"))
      state = sdk.getStateForAction(
        state,
        {
          type: "PUSH",
          payload: { name: "product/[id]", params: { id: "other" } },
        },
        options,
      )! as typeof state;
    const apply = (
      type: "PUSH" | "NAVIGATE" | "POP_TO",
      destination:
        string | { pathname: string; params?: Record<string, string> },
    ) => {
      const pathname =
        typeof destination === "string" ? destination : destination.pathname;
      state = sdk.getStateForAction(
        state,
        {
          type,
          payload: {
            name: pathname.slice(1),
            params:
              typeof destination === "string" ? undefined : destination.params,
          },
        },
        options,
      )! as typeof state;
    };
    runtime.rootState = state;
    runtime.push.mockImplementation((destination) =>
      apply("PUSH", destination),
    );
    runtime.navigate.mockImplementation((destination) =>
      apply("NAVIGATE", destination),
    );
    runtime.dismissTo.mockImplementation((destination) =>
      apply("POP_TO", destination),
    );
    await render();
    runtime.list.mockResolvedValue([{ reminder: f.reminder }]);
    const data = mode.includes("TEST")
      ? { kind: "COMMERCIAL_REMINDER_TEST", storeId: f.reminder.storeId }
      : f.data;
    await act(async () => {
      [...runtime.responseListeners][0]!(response(data));
    });
    const firstKey = state.routes[state.index]!.key;
    await act(async () => {
      [...runtime.responseListeners][0]!(response(data));
    });
    expect(state.routes).toHaveLength(2);
    expect(state.routes[state.index]!.name).toBe(target);
    expect(state.routes[state.index]!.key).toBe(originalKey ?? firstKey);
    expect(runtime.push).not.toHaveBeenCalled();
  },
);

it("opens a store email alert in Actions once, without importing or writing", async () => {
  const data = {
    kind: "STORE_EMAIL_READY",
    storeId: runtime.storeId,
    ownerId: runtime.ownerId,
    receiptId: "77777777-7777-4777-8777-777777777777",
  };
  runtime.lastResponse = { notification: { request: { content: { data } } } };
  await render();
  expect(runtime.navigate).toHaveBeenCalledWith({
    pathname: "/email-inbox",
    params: { receiptId: data.receiptId },
  });
  for (const listener of runtime.responseListeners)
    await act(async () =>
      listener({ notification: { request: { content: { data } } } }),
    );
  expect(runtime.navigate).toHaveBeenCalledTimes(1);
  expect(runtime.syncNow).not.toHaveBeenCalled();
  expect(runtime.destination).not.toHaveBeenCalled();
});
it.each(["owner", "store", "role"])(
  "refuses an email alert for another %s",
  async (field) => {
    const data = {
      kind: "STORE_EMAIL_READY",
      storeId: runtime.storeId,
      ownerId: runtime.ownerId,
      receiptId: "77777777-7777-4777-8777-777777777777",
    };
    if (field === "owner") data.ownerId = data.receiptId;
    if (field === "store") data.storeId = data.receiptId;
    if (field === "role") runtime.role = "VIEWER";
    runtime.lastResponse = { notification: { request: { content: { data } } } };
    await render();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(runtime.dismissTo).not.toHaveBeenCalled();
    runtime.role = "MANAGER";
  },
);

it("opens the existing document detail once for repeated concurrent notification taps", async () => {
  runtime.sqlite.getFirstAsync.mockResolvedValue({
    source_type: "WEEKLY_COMMERCIAL_PDF",
  });
  await render();
  const data = {
    kind: "SOURCE_DOCUMENT_READY",
    resultKey: "a".repeat(64),
    storeId: runtime.storeId,
    ownerId: runtime.ownerId,
    sourceDocumentId: "77777777-7777-4777-8777-777777777777",
    sourceType: "WEEKLY_COMMERCIAL_PDF",
  };
  await act(async () => {
    const listener = [...runtime.responseListeners][0]!;
    listener(response(data));
    listener(response(data));
  });
  expect(runtime.navigate).toHaveBeenCalledTimes(1);
  expect(runtime.navigate).toHaveBeenCalledWith({
    pathname: "/document-review/[id]",
    params: { id: data.sourceDocumentId },
  });
  expect(runtime.syncNow).not.toHaveBeenCalled();
});
it("does not open a document after account change during notification synchronization", async () => {
  await render();
  const pending = deferred<void>();
  runtime.syncNow.mockReturnValue(pending.promise);
  const data = {
    kind: "SOURCE_DOCUMENT_READY",
    resultKey: "a".repeat(64),
    storeId: runtime.storeId,
    ownerId: runtime.ownerId,
    sourceDocumentId: "77777777-7777-4777-8777-777777777777",
    sourceType: "WEEKLY_COMMERCIAL_PDF",
  };
  let handling: unknown;
  await act(async () => {
    handling = [...runtime.responseListeners][0]!(response(data));
  });
  runtime.ownerId = "88888888-8888-4888-8888-888888888888";
  await render();
  await act(async () => {
    pending.resolve();
    await handling;
  });
  expect(runtime.navigate).not.toHaveBeenCalled();
  expect(runtime.dismissTo).not.toHaveBeenCalled();
});
