import Constants from "expo-constants";
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  reminderFingerprint,
  type CommercialReminder,
} from "@fl-copilot/domain";
import type { NotificationAdapter } from "./reconcile";
let modulePromise: Promise<typeof import("expo-notifications")> | undefined;
let registrationGeneration = 0;
export function nativeRegistrationIsCurrent() {
  const generation = registrationGeneration;
  return () => generation === registrationGeneration;
}
/** Local logout never needs connectivity to retire delivery or old previews. */
export async function retirePrivateNotifications() {
  registrationGeneration++;
  if (Platform.OS === "web" || Constants.appOwnership === "expo") return;
  const n = await notificationModule();
  if (!n) return;
  await Promise.all([
    n.unregisterForNotificationsAsync(),
    n.cancelAllScheduledNotificationsAsync(),
    n.dismissAllNotificationsAsync(),
  ]);
}
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
  const current = nativeRegistrationIsCurrent();
  const n = await notificationModule();
  if (!n) return null;
  return {
    permission: async () => {
      if (!current()) return false;
      const p = await n.getPermissionsAsync();
      return (
        p.granted || p.ios?.status === n.IosAuthorizationStatus.PROVISIONAL
      );
    },
    pending: async () =>
      (current() ? await n.getAllScheduledNotificationsAsync() : []).map(
        (v) => ({
          identifier: v.identifier,
          data: v.content.data,
        }),
      ),
    cancel: async (id) => {
      if (current()) await n.cancelScheduledNotificationAsync(id);
    },
    schedule: async (r: CommercialReminder) => {
      if (!current()) throw Error("NOTIFICATION_CONTEXT_CHANGED");
      const identifier = await n.scheduleNotificationAsync({
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
      });
      if (!current()) {
        await n.cancelScheduledNotificationAsync(identifier);
        throw Error("NOTIFICATION_CONTEXT_CHANGED");
      }
      return identifier;
    },
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
