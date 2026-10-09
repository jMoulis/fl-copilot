import {
  commercialReminderSchema,
  type CommercialReminder,
} from "@fl-copilot/domain";
import { commercialExecutionPlanChecksum } from "@fl-copilot/commercial-core";
import { commercialWeekPlanSchema } from "@fl-copilot/domain";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import type { OutboxDatabase } from "../sync/outbox-repository";
const listeners = new Set<() => void>();
export function subscribeReminders(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const snapshotListeners = new Set<() => void>();
export function subscribeReminderSnapshots(fn: () => void) {
  snapshotListeners.add(fn);
  return () => {
    snapshotListeners.delete(fn);
  };
}
function snapshotChanged() {
  for (const fn of snapshotListeners) fn();
}
function changed() {
  snapshotChanged();
  for (const f of listeners) f();
}
export type ReminderStatus =
  | "SCHEDULED"
  | "DISABLED"
  | "WAITING_SYNC"
  | "PLAN_CHANGED"
  | "PERMISSION_DENIED"
  | "PAST"
  | "LIMIT"
  | "ERROR"
  | "NOT_AVAILABLE"
  | "PENDING";
export class ReminderRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private digest: (s: string) => Promise<string>,
  ) {}
  async preferences(storeId: string) {
    return (
      (
        await this.db.getFirstAsync<{ enabled: number }>(
          "SELECT enabled FROM device_reminder_preferences WHERE store_id=?",
          storeId,
        )
      )?.enabled === 1
    );
  }
  async setEnabled(
    storeId: string,
    enabled: boolean,
    actionId: string,
    now: string,
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "INSERT INTO device_reminder_preferences(store_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(store_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at",
        storeId,
        enabled ? 1 : 0,
        now,
      );
      await tx.runAsync(
        "INSERT INTO device_reminder_history(action_id,store_id,payload_json,created_at) VALUES(?,?,?,?)",
        actionId,
        storeId,
        JSON.stringify({ kind: "PREFERENCES", enabled }),
        now,
      );
    });
    changed();
  }
  async list(storeId: string) {
    const rows = await this.db.getAllAsync<{
      payload_json: string;
      status: ReminderStatus;
      notification_id: string | null;
    }>(
      "SELECT * FROM device_commercial_reminders WHERE store_id=? ORDER BY json_extract(payload_json,'$.fireAt')",
      storeId,
    );
    return rows.map((r) => ({
      reminder: commercialReminderSchema.parse(JSON.parse(r.payload_json)),
      status: r.status,
      notificationId: r.notification_id,
    }));
  }
  async save(input: CommercialReminder, actionId: string) {
    const value = commercialReminderSchema.parse(input);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (value.enabled) {
        const root = await tx.getFirstAsync<{
          payload_json: string;
          sync_state: string;
        }>(
          "SELECT payload_json,sync_state FROM commercial_week_plans WHERE store_id=? AND id=?",
          value.storeId,
          value.planId,
        );
        if (!root || root.sync_state !== "SYNCED")
          throw Error("Synchronisez le plan avant de créer un rappel.");
        const plan = commercialWeekPlanSchema.parse(
            JSON.parse(root.payload_json),
          ),
          op = plan.operations.find((o) => o.id === value.operationId);
        if (
          !op ||
          plan.revisionId !== value.planRevisionId ||
          plan.weekStart !== value.weekStart ||
          op.plannedStart !== value.deadlineDate ||
          (await commercialExecutionPlanChecksum(plan, this.digest)) !==
            value.planChecksum
        )
          throw Error(
            "Le plan a changé. Rouvrez l’opération avant de programmer son rappel.",
          );
      }
      const row = await tx.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM device_commercial_reminders WHERE store_id=? AND operation_id=?",
        value.storeId,
        value.operationId,
      );
      const old = row
        ? commercialReminderSchema.parse(JSON.parse(row.payload_json))
        : null;
      if (
        value.version !== (old?.version ?? 0) + 1 ||
        (old && (old.id !== value.id || old.createdAt !== value.createdAt))
      )
        throw Error(
          "Le rappel a changé. Rouvrez l’écran avant de l’enregistrer.",
        );
      const collision = await tx.getFirstAsync<{ store_id: string }>(
        "SELECT store_id FROM device_commercial_reminders WHERE id=?",
        value.id,
      );
      if (collision && (!old || collision.store_id !== value.storeId))
        throw Error("Rappel d’un autre magasin.");
      if (!value.enabled && !old) throw Error("Rappel introuvable.");
      await tx.runAsync(
        "INSERT INTO device_commercial_reminders(id,store_id,operation_id,payload_json,status) VALUES(?,?,?,?,'PENDING') ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,status='PENDING'",
        value.id,
        value.storeId,
        value.operationId,
        JSON.stringify(value),
      );
      await tx.runAsync(
        "INSERT INTO device_reminder_history(action_id,store_id,payload_json,created_at) VALUES(?,?,?,?)",
        actionId,
        value.storeId,
        JSON.stringify(value),
        value.updatedAt,
      );
    });
    changed();
  }
  async setStatus(
    r: CommercialReminder,
    status: ReminderStatus,
    notificationId: string | null,
  ) {
    await this.db.runAsync(
      "UPDATE device_commercial_reminders SET status=?,notification_id=? WHERE id=? AND store_id=? AND json_extract(payload_json,'$.version')=?",
      status,
      notificationId,
      r.id,
      r.storeId,
      r.version,
    );
    snapshotChanged();
  }
}
