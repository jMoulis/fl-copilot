import {
  reminderFingerprint,
  reminderNotificationDataSchema,
  type CommercialReminder,
} from "@fl-copilot/domain";
import type { ReminderStatus } from "./repository";
export type PendingNotification = { identifier: string; data: unknown };
export type NotificationAdapter = {
  permission(): Promise<boolean>;
  pending(): Promise<PendingNotification[]>;
  cancel(id: string): Promise<void>;
  schedule(r: CommercialReminder): Promise<string>;
};
export type ReminderPlan = {
  id: string;
  revisionId: string;
  checksum: string;
  syncState: string;
  needsReview: boolean;
  operations: Array<{ id: string; plannedStart: string }>;
};
export async function reconcileReminders(input: {
  storeId?: string;
  enabled: boolean;
  reminders: CommercialReminder[];
  plans: ReminderPlan[];
  native: NotificationAdapter | null;
  now: Date;
  isCurrent: () => boolean;
  status: (
    r: CommercialReminder,
    s: ReminderStatus,
    id: string | null,
  ) => Promise<void>;
}) {
  const { native } = input;
  if (!native) {
    for (const r of input.reminders)
      await input.status(r, "NOT_AVAILABLE", null);
    return;
  }
  const granted = await native.permission(),
    pending = await native.pending();
  const statuses = new Map<string, ReminderStatus>(),
    desired = new Map<string, CommercialReminder>();
  for (const r of input.reminders) {
    let state: ReminderStatus = "SCHEDULED";
    const plan = input.plans.find((p) => p.id === r.planId);
    if (!input.enabled || !r.enabled || r.storeId !== input.storeId)
      state = "DISABLED";
    else if (!granted) state = "PERMISSION_DENIED";
    else if (r.fireAt <= input.now.toISOString()) state = "PAST";
    else if (
      !plan ||
      plan.revisionId !== r.planRevisionId ||
      plan.checksum !== r.planChecksum ||
      plan.needsReview ||
      !plan.operations.some(
        (o) => o.id === r.operationId && o.plannedStart === r.deadlineDate,
      )
    )
      state = "PLAN_CHANGED";
    else if (plan.syncState === "ERROR" || plan.syncState === "CONFLICT")
      state = "PLAN_CHANGED";
    else if (plan.syncState !== "SYNCED") state = "WAITING_SYNC";
    else if (desired.size >= 32) state = "LIMIT";
    if (state === "SCHEDULED") desired.set(r.id, r);
    statuses.set(r.id, state);
  }
  const existing = new Map<string, string>();
  for (const p of pending) {
    const parsed = reminderNotificationDataSchema.safeParse(p.data);
    if (
      !input.isCurrent() &&
      (typeof p.data !== "object" ||
        p.data === null ||
        !("storeId" in p.data) ||
        p.data.storeId !== input.storeId)
    )
      continue;
    if (!parsed.success) {
      if (
        typeof p.data === "object" &&
        p.data !== null &&
        "kind" in p.data &&
        (p.data.kind === "COMMERCIAL_REMINDER" ||
          (p.data.kind === "COMMERCIAL_REMINDER_TEST" &&
            "storeId" in p.data &&
            p.data.storeId !== input.storeId))
      )
        await native.cancel(p.identifier);
      continue;
    }
    const r = desired.get(parsed.data.reminderId);
    if (
      input.isCurrent() &&
      r &&
      parsed.data.fingerprint === reminderFingerprint(r) &&
      parsed.data.storeId === r.storeId &&
      parsed.data.operationId === r.operationId &&
      parsed.data.revisionId === r.planRevisionId &&
      parsed.data.weekStart === r.weekStart &&
      !existing.has(r.id)
    )
      existing.set(r.id, p.identifier);
    else await native.cancel(p.identifier);
  }
  for (const r of input.reminders) {
    let id = existing.get(r.id) ?? null,
      state = statuses.get(r.id)!;
    if (state === "SCHEDULED" && !id && input.isCurrent()) {
      try {
        id = await native.schedule(r);
        if (!input.isCurrent()) {
          await native.cancel(id);
          id = null;
          state = "DISABLED";
        }
      } catch {
        state = "ERROR";
      }
    } else if (!input.isCurrent()) {
      if (id) await native.cancel(id);
      id = null;
      state = "DISABLED";
    }
    await input.status(r, state, id);
  }
}
