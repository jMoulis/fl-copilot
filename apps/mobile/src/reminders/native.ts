import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  reminderFingerprint,
  type CommercialReminder,
} from "@fl-copilot/domain";
import type { NotificationAdapter } from "./reconcile";
let modulePromise: Promise<typeof import("expo-notifications")> | undefined;
export function notificationsAvailable() {
  return (
    Platform.OS !== "web" &&
    !!requireOptionalNativeModule("ExpoNotificationScheduler") &&
    !!requireOptionalNativeModule("ExpoNotificationPermissionsModule") &&
    !!requireOptionalNativeModule("ExpoNotificationsEmitter")
  );
}
export async function notificationModule() {
  if (!notificationsAvailable()) return null;
  modulePromise ??= import("expo-notifications");
  return modulePromise;
}
export async function notificationAdapter(): Promise<NotificationAdapter | null> {
  const n = await notificationModule();
  if (!n) return null;
  return {
    permission: async () => {
      const p = await n.getPermissionsAsync();
      return (
        p.granted || p.ios?.status === n.IosAuthorizationStatus.PROVISIONAL
      );
    },
    pending: async () =>
      (await n.getAllScheduledNotificationsAsync()).map((v) => ({
        identifier: v.identifier,
        data: v.content.data,
      })),
    cancel: (id) => n.cancelScheduledNotificationAsync(id),
    schedule: (r: CommercialReminder) =>
      n.scheduleNotificationAsync({
        identifier: `fl-reminder-${r.id}`,
        content: {
          title: "Préparer une opération",
          body: "Un démarrage est prévu. Consultez le plan et vos tâches dans l’application.",
          sound: "default",
          data: {
            kind: "COMMERCIAL_REMINDER",
            reminderId: r.id,
            storeId: r.storeId,
            operationId: r.operationId,
            weekStart: r.weekStart,
            revisionId: r.planRevisionId,
            fingerprint: reminderFingerprint(r),
          },
        },
        trigger: {
          type: n.SchedulableTriggerInputTypes.DATE,
          date: new Date(r.fireAt),
          channelId: "commercial-reminders",
        },
      }),
  };
}
export async function requestReminderPermission() {
  const n = await notificationModule();
  if (!n)
    throw Error(
      "Installez le nouveau build pour activer les rappels sur ce téléphone.",
    );
  if (Platform.OS === "android")
    await n.setNotificationChannelAsync("commercial-reminders", {
      name: "Rappels commerciaux",
      importance: n.AndroidImportance.DEFAULT,
    });
  const p = await n.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return p.granted || p.ios?.status === n.IosAuthorizationStatus.PROVISIONAL;
}
