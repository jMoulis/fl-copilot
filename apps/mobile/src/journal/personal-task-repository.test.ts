import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { personalTaskFingerprint, type PersonalTask } from "@fl-copilot/domain";
import { VisualTestDatabase } from "../../../../scripts/test-visual-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { OutboxRepository } from "../sync/outbox-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  PersonalTaskRepository,
  applyPersonalTaskRecord,
} from "./personal-task-repository";
import {
  reconcilePersonalTaskReminders,
  personalReminderSetting,
  type PersonalReminderAdapter,
} from "./personal-task-reminders";
const dirs: string[] = [],
  dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const d of dbs.splice(0))
    try {
      d.close();
    } catch {
      /* explicitly reopened */
    }
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "personal-tasks-"));
  dirs.push(dir);
  const path = join(dir, "local.sqlite"),
    db = new DatabaseSync(path);
  dbs.push(db);
  const adapter = new VisualTestDatabase(db);
  await runLocalMigrations(adapter);
  const scope = { storeId: randomUUID(), ownerId: randomUUID() },
    id = randomUUID(),
    ctx = () => ({
      commandId: randomUUID(),
      deviceId: randomUUID(),
      now: "2026-11-14T09:00:00.000Z",
      canWrite: () => true,
    });
  return {
    db,
    adapter,
    scope,
    id,
    path,
    repo: new PersonalTaskRepository(adapter, scope),
    ctx,
    fields: {
      text: "Contrôler les avocats",
      date: "2026-11-14",
      time: "16:00",
      status: "TODO" as const,
    },
  };
}
it("persists edits, private ownership and ordered outbox across app restart; stale forms do not overwrite", async () => {
  const f = await fixture();
  await f.repo.save(f.id, f.fields, null, f.ctx());
  await f.repo.save(
    f.id,
    { ...f.fields, text: "Contrôler la maturité" },
    1,
    f.ctx(),
  );
  await expect(
    f.repo.save(f.id, { ...f.fields, text: "Ancien formulaire" }, 1, f.ctx()),
  ).rejects.toThrow("REVIEW_REQUIRED");
  f.db.close();
  const db = new DatabaseSync(f.path);
  dbs.push(db);
  const adapter = new VisualTestDatabase(db),
    repo = new PersonalTaskRepository(adapter, f.scope);
  expect((await repo.get(f.id))?.entity).toMatchObject({
    text: "Contrôler la maturité",
    version: 2,
  });
  expect(
    await new PersonalTaskRepository(adapter, {
      ...f.scope,
      ownerId: randomUUID(),
    }).get(f.id),
  ).toBeNull();
  expect(
    await new PersonalTaskRepository(adapter, {
      ...f.scope,
      storeId: randomUUID(),
    }).list(f.fields.date, f.fields.date),
  ).toEqual([]);
  const outbox = new OutboxRepository(adapter);
  expect(await outbox.listPending(f.scope.storeId, 100, randomUUID())).toEqual(
    [],
  );
  expect(
    await outbox.listPending(f.scope.storeId, 100, f.scope.ownerId),
  ).toHaveLength(1);
  const first = (
    await outbox.listPending(f.scope.storeId, 100, f.scope.ownerId)
  )[0]!;
  await outbox.markSyncing(first.commandId);
  await outbox.markAcknowledged(first.commandId);
  expect(
    (await outbox.listPending(f.scope.storeId, 100, f.scope.ownerId))[0]
      ?.payload,
  ).toMatchObject({ version: 2 });
});
it("rolls back both task and command if the account changes during capture", async () => {
  const f = await fixture();
  let calls = 0;
  await expect(
    f.repo.save(f.id, f.fields, null, {
      ...f.ctx(),
      canWrite: () => ++calls < 2,
    }),
  ).rejects.toThrow("SCOPE");
  expect(await f.repo.get(f.id)).toBeNull();
  expect(f.db.prepare("SELECT count(*) n FROM sync_outbox").get()!.n).toBe(0);
});
it("retains local status/date changes through a delayed acknowledgement and records real completion separately", async () => {
  const f = await fixture(),
    v1 = await f.repo.save(f.id, f.fields, null, f.ctx());
  const v2 = await f.repo.save(
    f.id,
    { ...f.fields, date: "2026-11-13", status: "DONE" },
    1,
    { ...f.ctx(), now: "2026-11-14T10:00:00.000Z" },
  );
  await applyPersonalTaskRecord(f.adapter, f.scope, v1, 1);
  expect((await f.repo.get(f.id))?.entity).toEqual(v2);
  expect(v2.completedAt).toBe("2026-11-14T10:00:00.000Z");
  await applyPersonalTaskRecord(f.adapter, f.scope, v2, 2);
  expect((await f.repo.get(f.id))?.syncState).toBe("SYNCED");
  await f.repo.save(f.id, { ...f.fields, status: "TODO" }, 2, {
    ...f.ctx(),
    now: "2026-11-14T11:00:00.000Z",
  });
  expect((await f.repo.get(f.id))?.entity.completedAt).toBeNull();
  await expect(
    applyPersonalTaskRecord(
      f.adapter,
      { ...f.scope, ownerId: randomUUID() },
      v2,
    ),
  ).rejects.toThrow("SCOPE");
});
it("compares concurrent versions, rejects a changed review, and preserves both histories when adopting remote", async () => {
  const f = await fixture(),
    v1 = await f.repo.save(f.id, f.fields, null, f.ctx());
  await applyPersonalTaskRecord(f.adapter, f.scope, v1, 1);
  const box = new OutboxRepository(f.adapter);
  const initialCommand = (await box.listPending(f.scope.storeId))[0]!;
  await box.markSyncing(initialCommand.commandId);
  await box.markAcknowledged(initialCommand.commandId);
  const local = await f.repo.save(
      f.id,
      { ...f.fields, text: "Ma version" },
      1,
      f.ctx(),
    ),
    command = (await box.listPending(f.scope.storeId))[0]!,
    remote: PersonalTask = {
      ...local,
      text: "Autre appareil",
      date: "2026-11-15",
    };
  await new ConflictRepository(f.adapter).recordPushConflict(command, {
    commandId: command.commandId,
    entityType: "personal_task",
    entityId: f.id,
    status: "CONFLICT",
    remoteVersion: 2,
    remoteEntity: remote,
  });
  await f.adapter.runAsync(
    "UPDATE personal_tasks SET sync_state='CONFLICT' WHERE id=?",
    f.id,
  );
  const r = await f.repo.review(f.id);
  expect(r.ready).toBe(true);
  await f.adapter.runAsync(
    "UPDATE personal_tasks SET remote_payload_json=?,remote_version=2 WHERE id=?",
    JSON.stringify(remote),
    f.id,
  );
  await expect(f.repo.resolve(f.id, false, r.token, f.ctx())).rejects.toThrow(
    "REVIEW_CHANGED",
  );
  const current = await f.repo.review(f.id);
  await f.repo.resolve(f.id, false, current.token, f.ctx());
  expect((await f.repo.get(f.id))?.entity).toEqual(remote);
  expect(await box.listPending(f.scope.storeId, 100, f.scope.ownerId)).toEqual(
    [],
  );
  expect(
    f.db.prepare("SELECT count(*) n FROM personal_task_history").get()!.n,
  ).toBeGreaterThan(2);
});
it("schedules once locally, cancels on completion, and preserves tasks if notifications are denied or fail", async () => {
  const f = await fixture(),
    t = await f.repo.save(f.id, f.fields, null, { ...f.ctx(), reminder: true });
  const pending = new Map<string, { identifier: string; data: unknown }>();
  let granted = true;
  const native: PersonalReminderAdapter = {
    permission: async () => granted,
    pending: async () => [...pending.values()],
    cancel: vi.fn(async (id) => {
      pending.delete(id);
    }),
    schedule: vi.fn(async (task) => {
      const identifier = "test:" + task.id;
      pending.set(identifier, {
        identifier,
        data: {
          kind: "PERSONAL_TASK",
          taskId: task.id,
          storeId: task.storeId,
          ownerId: task.ownerId,
          fingerprint: personalTaskFingerprint(task),
        },
      });
      return identifier;
    }),
  };
  const run = () =>
    reconcilePersonalTaskReminders(
      f.adapter,
      f.scope,
      native,
      new Date("2026-11-14T10:00:00Z"),
      () => true,
    );
  await run();
  await run();
  expect(native.schedule).toHaveBeenCalledTimes(1);
  expect(
    (await personalReminderSetting(f.adapter, f.scope, f.id))?.status,
  ).toBe("SCHEDULED");
  await f.repo.save(f.id, { ...f.fields, status: "DONE" }, 1, f.ctx());
  await run();
  expect(pending.size).toBe(0);
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await f.repo.save(f.id, f.fields, 2, { ...f.ctx(), reminder: true });
  granted = false;
  await run();
  expect(
    (await personalReminderSetting(f.adapter, f.scope, f.id))?.status,
  ).toBe("PERMISSION_DENIED");
  expect((await f.repo.get(f.id))?.entity.text).toBe(t.text);
  granted = true;
  native.schedule = vi.fn(async () => {
    throw Error("OS unavailable");
  });
  await run();
  expect(
    (await personalReminderSetting(f.adapter, f.scope, f.id))?.status,
  ).toBe("FAILED");
  await reconcilePersonalTaskReminders(
    f.adapter,
    f.scope,
    native,
    new Date("2026-11-15T10:00:00Z"),
    () => true,
  );
  expect(
    (await personalReminderSetting(f.adapter, f.scope, f.id))?.status,
  ).toBe("PAST");
});

it("cancels an OS schedule obtained after a concurrent task completion, without overwriting its OFF state", async () => {
  const f = await fixture();
  await f.repo.save(f.id, f.fields, null, { ...f.ctx(), reminder: true });
  const cancel = vi.fn(async () => {});
  const native: PersonalReminderAdapter = {
    permission: async () => true,
    pending: async () => [],
    cancel,
    schedule: async () => {
      await f.repo.save(f.id, { ...f.fields, status: "DONE" }, 1, f.ctx());
      return "late-notification";
    },
  };
  await reconcilePersonalTaskReminders(
    f.adapter,
    f.scope,
    native,
    new Date("2026-11-14T10:00:00Z"),
    () => true,
  );
  expect(cancel).toHaveBeenCalledWith("late-notification");
  expect(await personalReminderSetting(f.adapter, f.scope, f.id)).toMatchObject(
    { enabled: 0, status: "OFF" },
  );
  expect((await f.repo.get(f.id))?.entity.status).toBe("DONE");
});
