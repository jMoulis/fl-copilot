import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ReminderSettings from "../app/reminder-settings";
const runtime = vi.hoisted(() => ({
  session: { user: { id: "owner-a" }, stores: [{ storeId: "store-a" }] },
  database: { sqlite: {}, deviceId: "device" },
  focused: true,
  preferences: vi.fn<(store: string) => Promise<boolean>>(async () => false),
  list: vi.fn<(store: string) => Promise<unknown[]>>(async () => []),
  setEnabled: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  permission: vi.fn(async () => true),
  schedule: vi.fn<(input: { identifier: string }) => Promise<string>>(
    async () => "notification",
  ),
  cancel: vi.fn(async () => {}),
  listeners: new Set<() => void>(),
}));
vi.mock("@/auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("@/providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("@/reminders/repository", () => ({
  ReminderRepository: class {
    preferences = runtime.preferences;
    list = runtime.list;
    setEnabled = runtime.setEnabled;
    save = runtime.save;
  },
  subscribeReminderSnapshots: (fn: () => void) => {
    runtime.listeners.add(fn);
    return () => runtime.listeners.delete(fn);
  },
}));
vi.mock("@/reminders/provider", () => ({
  useReminders: () => ({ refresh: runtime.refresh, available: true }),
}));
vi.mock("@/reminders/native", () => ({
  requestReminderPermission: runtime.permission,
  notificationModule: async () => ({
    scheduleNotificationAsync: runtime.schedule,
    cancelScheduledNotificationAsync: runtime.cancel,
    SchedulableTriggerInputTypes: { DATE: "date" },
  }),
}));
vi.mock("@/reminders/presentation", () => ({
  reminderStatusLabel: () => "Programmé",
}));
vi.mock("@/dates/calendar", () => ({
  formatFrenchCalendarDate: (s: string) => s,
}));
vi.mock("@/components/ui", () => ({
  AppScreen: "Screen",
  AppHeader: "Header",
  SectionCard: "Card",
  SecondaryButton: "Button",
  InlineAlert: "Alert",
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Switch: "Switch",
  Linking: { openSettings: vi.fn(async () => {}) },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "test-action",
  digestStringAsync: async () => "digest",
  CryptoDigestAlgorithm: { SHA256: "sha256" },
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
  useFocusEffect: (fn: () => void | (() => void)) => {
    const focused = runtime.focused;
    useEffect(() => (focused ? fn() : undefined), [fn, focused]);
  },
}));
let tree: ReactTestRenderer | undefined;
const hosts = (tag: string) =>
  tree!.root.findAll((n) => typeof n.type === "string" && n.type === tag);
const button = (label: string) =>
  hosts("Button").find((n) => n.props.label === label)!;
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  runtime.session = {
    user: { id: "owner-a" },
    stores: [{ storeId: "store-a" }],
  };
  runtime.focused = true;
  runtime.database = { sqlite: {}, deviceId: "device" };
  runtime.preferences.mockReset().mockResolvedValue(false);
  runtime.list.mockReset().mockResolvedValue([]);
  runtime.setEnabled.mockClear();
  runtime.save.mockClear();
  runtime.refresh.mockReset().mockResolvedValue();
  runtime.permission.mockReset().mockResolvedValue(true);
  runtime.schedule.mockClear();
  runtime.cancel.mockClear();
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  expect(runtime.listeners.size).toBe(0);
});
async function mount() {
  await act(async () => {
    tree = create(createElement(ReminderSettings));
  });
}
it("shows a failed verification without losing retained reminders or leaving the button busy", async () => {
  runtime.list.mockResolvedValue([
    {
      reminder: {
        id: "retained",
        operationId: "operation",
        deadlineDate: "2026-10-26",
        fireAt: "2026-10-25T08:00:00Z",
        enabled: true,
      },
      status: "SCHEDULED",
    },
  ]);
  await mount();
  runtime.refresh.mockRejectedValueOnce(Error("provider unavailable"));
  await act(async () => {
    button("Vérifier les rappels programmés").props.onPress();
  });
  expect(hosts("Alert").some((n) => /vérifi|relu/i.test(n.props.message))).toBe(
    true,
  );
  expect(button("Désactiver ce rappel")).toBeDefined();
  expect(button("Vérifier les rappels programmés").props.disabled).toBe(false);
});
it("rejects a retained button from another owner/store context", async () => {
  await mount();
  const old = button("Vérifier les rappels programmés").props.onPress;
  runtime.session = {
    user: { id: "owner-b" },
    stores: [{ storeId: "store-b" }],
  };
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  await act(async () => {
    old();
  });
  expect(runtime.refresh).not.toHaveBeenCalled();
});
it("does not save an old activation after its permission request outlives the owner context", async () => {
  await mount();
  const permission = deferred<boolean>();
  runtime.permission.mockReturnValueOnce(permission.promise);
  await act(async () => {
    hosts("Switch")[0]!.props.onValueChange(true);
  });
  runtime.session = {
    user: { id: "owner-b" },
    stores: [{ storeId: "store-b" }],
  };
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  await act(async () => {
    permission.resolve(true);
  });
  expect(runtime.setEnabled).not.toHaveBeenCalled();
});
it("ignores a previous store's late list result while reading the new store", async () => {
  const old = deferred<unknown[]>(),
    next = deferred<unknown[]>();
  runtime.list.mockImplementation((store) =>
    store === "store-a" ? old.promise : next.promise,
  );
  await mount();
  runtime.session = {
    user: { id: "owner-b" },
    stores: [{ storeId: "store-b" }],
  };
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  await act(async () => {
    old.resolve([
      {
        reminder: {
          id: "foreign",
          operationId: "operation-a",
          deadlineDate: "2026-10-26",
          fireAt: "2026-10-25T08:00:00Z",
          enabled: true,
        },
        status: "SCHEDULED",
      },
    ]);
  });
  expect(Boolean(button("Désactiver ce rappel"))).toBe(false);
  await act(async () => {
    next.resolve([]);
  });
});
it("coalesces a double activation and accepts an equivalent refreshed session", async () => {
  await mount();
  const permission = deferred<boolean>();
  runtime.permission.mockReturnValueOnce(permission.promise);
  const toggle = hosts("Switch")[0]!.props.onValueChange;
  await act(async () => {
    toggle(true);
    toggle(true);
  });
  expect(runtime.permission).toHaveBeenCalledTimes(1);
  runtime.session = {
    user: { id: "owner-a" },
    stores: [{ storeId: "store-a" }],
  };
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  await act(async () => {
    permission.resolve(true);
  });
  expect(runtime.setEnabled).toHaveBeenCalledTimes(1);
  expect(runtime.refresh).toHaveBeenCalledTimes(1);
});
it("ignores a permission result and retained listener after focus closes", async () => {
  await mount();
  const permission = deferred<boolean>(),
    read = [...runtime.listeners][0]!;
  runtime.permission.mockReturnValueOnce(permission.promise);
  await act(async () => {
    hosts("Switch")[0]!.props.onValueChange(true);
  });
  runtime.focused = false;
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  const reads = runtime.list.mock.calls.length;
  await act(async () => {
    read();
    permission.resolve(true);
  });
  expect(runtime.list).toHaveBeenCalledTimes(reads);
  expect(runtime.setEnabled).not.toHaveBeenCalled();
});
it("does not leak retained rows into a new store while its first read is pending", async () => {
  runtime.list.mockResolvedValue([
    {
      reminder: {
        id: "retained",
        operationId: "operation",
        deadlineDate: "2026-10-26",
        fireAt: "2026-10-25T08:00:00Z",
        enabled: true,
      },
      status: "SCHEDULED",
    },
  ]);
  await mount();
  expect(Boolean(button("Désactiver ce rappel"))).toBe(true);
  const next = deferred<unknown[]>();
  runtime.list.mockReturnValueOnce(next.promise);
  runtime.session = {
    user: { id: "owner-b" },
    stores: [{ storeId: "store-b" }],
  };
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  expect(Boolean(button("Désactiver ce rappel"))).toBe(false);
  await act(async () => {
    next.resolve([]);
  });
});
it("cancels only its own late test notification after leaving the screen", async () => {
  await mount();
  const scheduled = deferred<string>();
  runtime.schedule.mockReturnValueOnce(scheduled.promise);
  await act(async () => {
    button("Tester un rappel dans une minute").props.onPress();
  });
  const id = runtime.schedule.mock.calls[0]![0] as { identifier: string };
  runtime.focused = false;
  await act(async () => {
    tree!.update(createElement(ReminderSettings));
  });
  await act(async () => {
    scheduled.resolve("notification");
  });
  expect(runtime.cancel).toHaveBeenCalledExactlyOnceWith(id.identifier);
});
it("keeps denied notification permission explicit without writing preferences", async () => {
  await mount();
  runtime.permission.mockResolvedValueOnce(false);
  await act(async () => {
    hosts("Switch")[0]!.props.onValueChange(true);
  });
  expect(runtime.setEnabled).not.toHaveBeenCalled();
  expect(runtime.schedule).not.toHaveBeenCalled();
  expect(
    hosts("Alert").some((n) =>
      /Autorisez les notifications/.test(n.props.message),
    ),
  ).toBe(true);
});
it("does not reload on ordinary rerenders with the same owner, store and database", async () => {
  await mount();
  for (let i = 0; i < 40; i++) {
    runtime.session = {
      user: { id: "owner-a" },
      stores: [{ storeId: "store-a" }],
    };
    await act(async () => {
      tree!.update(createElement(ReminderSettings));
    });
  }
  expect(runtime.list).toHaveBeenCalledTimes(1);
  expect(runtime.preferences).toHaveBeenCalledTimes(1);
  expect(runtime.listeners.size).toBe(1);
});
