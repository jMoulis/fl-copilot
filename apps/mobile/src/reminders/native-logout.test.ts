import { beforeEach, expect, it, vi } from "vitest";
import {
  nativeRegistrationIsCurrent,
  notificationAdapter,
  retirePrivateNotifications,
} from "./native";
import { reminderFixture } from "../../../../scripts/test-reminder-fixtures";
const runtime = vi.hoisted(() => ({
  unregister: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
  dismiss: vi.fn(async () => {}),
  schedule: vi.fn(async () => "notification"),
  cancel: vi.fn(async (_id: string) => {
    void _id;
  }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-constants", () => ({ default: { appOwnership: "standalone" } }));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => ({}),
}));
vi.mock("expo-notifications", () => ({
  unregisterForNotificationsAsync: runtime.unregister,
  cancelAllScheduledNotificationsAsync: runtime.clear,
  dismissAllNotificationsAsync: runtime.dismiss,
  getPermissionsAsync: async () => ({ granted: true }),
  getAllScheduledNotificationsAsync: async () => [],
  scheduleNotificationAsync: runtime.schedule,
  cancelScheduledNotificationAsync: runtime.cancel,
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it("retires registration, delivered previews and scheduled reminders without a server request", async () => {
  const current = nativeRegistrationIsCurrent();
  const retiring = retirePrivateNotifications();
  expect(current()).toBe(false);
  await retiring;
  expect(runtime.unregister).toHaveBeenCalledTimes(1);
  expect(runtime.clear).toHaveBeenCalledTimes(1);
  expect(runtime.dismiss).toHaveBeenCalledTimes(1);
  expect(nativeRegistrationIsCurrent()()).toBe(true);
});
it("cancels a reminder that completed scheduling after logout and rejects future old scheduling", async () => {
  const adapter = (await notificationAdapter())!;
  let release!: (id: string) => void;
  runtime.schedule.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const { reminder } = await reminderFixture();
  const scheduling = adapter.schedule(reminder);
  const result = scheduling.then(
    () => null,
    (error: unknown) => error,
  );
  await retirePrivateNotifications();
  release("late-notification");
  expect(await result).toBeInstanceOf(Error);
  expect(runtime.cancel).toHaveBeenCalledWith("late-notification");
  await expect(adapter.schedule(reminder)).rejects.toThrow(
    "NOTIFICATION_CONTEXT_CHANGED",
  );
  expect(runtime.schedule).toHaveBeenCalledTimes(1);
});
