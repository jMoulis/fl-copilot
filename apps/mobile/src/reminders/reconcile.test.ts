import { it, expect, vi } from "vitest";
import { reminderFixture } from "../../../../scripts/test-reminder-fixtures";
import { reminderFingerprint } from "@fl-copilot/domain";
import {
  reconcileReminders,
  type NotificationAdapter,
  type PendingNotification,
} from "./reconcile";
import { CoalescedReminderRunner } from "./coalesced-runner";
async function setup() {
  const f = await reminderFixture(),
    pending = new Map<string, PendingNotification>(),
    status = vi.fn(async () => {});
  let permission = true;
  const native: NotificationAdapter = {
    permission: async () => permission,
    pending: async () => [...pending.values()],
    cancel: vi.fn(async (id) => {
      pending.delete(id);
    }),
    schedule: vi.fn(async (r) => {
      const id = `fl-reminder-${r.id}`;
      pending.set(id, {
        identifier: id,
        data: {
          kind: "COMMERCIAL_REMINDER",
          reminderId: r.id,
          storeId: r.storeId,
          operationId: r.operationId,
          weekStart: r.weekStart,
          revisionId: r.planRevisionId,
          fingerprint: reminderFingerprint(r),
        },
      });
      return id;
    }),
  };
  const input = {
    storeId: f.plan.storeId,
    enabled: true,
    reminders: [f.reminder],
    plans: [
      {
        id: f.plan.id,
        revisionId: f.plan.revisionId,
        checksum: f.reminder.planChecksum,
        syncState: "SYNCED",
        needsReview: false,
        operations: f.plan.operations,
      },
    ],
    native,
    now: new Date("2026-10-01T00:00:00Z"),
    isCurrent: () => true,
    status,
  };
  return {
    ...f,
    input,
    pending,
    native,
    status,
    setPermission: (v: boolean) => {
      permission = v;
    },
  };
}
it("recovers OS scheduling after restart without duplicates, replaces changed times and preserves unrelated notifications", async () => {
  const f = await setup();
  f.pending.set("other", { identifier: "other", data: { kind: "OTHER" } });
  await reconcileReminders(f.input);
  await reconcileReminders(f.input);
  expect(f.native.schedule).toHaveBeenCalledTimes(1);
  expect(f.pending.size).toBe(2);
  const next = {
    ...f.reminder,
    version: 2,
    fireAt: f.reminder.fireAt.replace("07:00", "08:00"),
  };
  await reconcileReminders({ ...f.input, reminders: [next] });
  expect(f.native.cancel).toHaveBeenCalledTimes(1);
  expect(f.native.schedule).toHaveBeenCalledTimes(2);
  expect(f.pending.has("other")).toBe(true);
  f.pending.delete(`fl-reminder-${next.id}`);
  await reconcileReminders({ ...f.input, reminders: [next] });
  expect(f.native.schedule).toHaveBeenCalledTimes(3);
});
it("cancels obsolete plans, revoked permission and logged-out reminders without asking for permission", async () => {
  const f = await setup();
  await reconcileReminders(f.input);
  f.input.plans[0]!.needsReview = true;
  await reconcileReminders(f.input);
  expect(f.status).toHaveBeenLastCalledWith(f.reminder, "PLAN_CHANGED", null);
  expect(f.pending.size).toBe(0);
  f.input.plans[0]!.needsReview = false;
  f.setPermission(false);
  await reconcileReminders(f.input);
  expect(f.status).toHaveBeenLastCalledWith(
    f.reminder,
    "PERMISSION_DENIED",
    null,
  );
  f.setPermission(true);
  await reconcileReminders(f.input);
  await reconcileReminders({
    ...f.input,
    storeId: undefined,
    reminders: [],
    plans: [],
    enabled: false,
  });
  expect(f.pending.size).toBe(0);
});
it("does not deliver past reminders or create alerts in older binaries and retries a failed OS write", async () => {
  const f = await setup();
  await reconcileReminders({
    ...f.input,
    now: new Date("2030-01-01T00:00:00Z"),
  });
  expect(f.native.schedule).not.toHaveBeenCalled();
  expect(f.status).toHaveBeenLastCalledWith(f.reminder, "PAST", null);
  await reconcileReminders({ ...f.input, native: null });
  expect(f.status).toHaveBeenLastCalledWith(f.reminder, "NOT_AVAILABLE", null);
  vi.mocked(f.native.schedule).mockRejectedValueOnce(Error("OS unavailable"));
  await reconcileReminders(f.input);
  expect(f.status).toHaveBeenLastCalledWith(f.reminder, "ERROR", null);
  await reconcileReminders(f.input);
  expect(f.pending.size).toBe(1);
});
it("cancels an in-flight native write when the account changes", async () => {
  const f = await setup();
  let current = true;
  const original = f.native.schedule;
  f.native.schedule = async (r) => {
    const id = await original(r);
    current = false;
    return id;
  };
  await reconcileReminders({ ...f.input, isCurrent: () => current });
  expect(f.pending.size).toBe(0);
  expect(f.status).toHaveBeenLastCalledWith(f.reminder, "DISABLED", null);
});
it("coalesces bursty sync events while retaining the latest account job", async () => {
  const runner = new CoalescedReminderRunner();
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
      release = r;
    }),
    calls: string[] = [];
  const first = runner.run(async () => {
    calls.push("first");
    await blocked;
  });
  await Promise.resolve();
  for (let n = 0; n < 50; n++)
    runner.run(async () => {
      calls.push(`last-${n}`);
    });
  release();
  await first;
  expect(calls).toEqual(["first", "last-49"]);
});
