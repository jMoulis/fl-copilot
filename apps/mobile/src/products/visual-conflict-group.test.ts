import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  nativeVisualConflictFixture,
  visualConflictKinds,
} from "../../../../scripts/test-visual-conflict-fixtures";
import { applyVisualEntity } from "./visual-library-repository";
import { ConflictRepository } from "../sync/conflict-repository";
for (const kind of visualConflictKinds) {
  it(`${kind} supports a complete owned multi-conflict group`, async () => {
    const s = await nativeVisualConflictFixture(kind);
    try {
      const command = await s.outbox.enqueue({
        ...s.review.command,
        commandId: randomUUID(),
      });
      await s.outbox.markSyncing(command.commandId);
      await new ConflictRepository(s.a).recordPushConflict(command, {
        commandId: command.commandId,
        entityType: kind,
        entityId: s.review.local.id,
        status: "CONFLICT",
        remoteVersion: s.review.remote.version,
        remoteEntity: s.review.remote,
      });
      await s.outbox.markConflict(command.commandId, "VISUAL_VERSION_CONFLICT");
      const review = await s.review.repo.review(
        s.f.storeId,
        s.review.conflict.id,
        s.f.actorId,
      );
      expect(review.canKeep).toBe(true);
      expect(review.canAdopt).toBe(true);
      expect(review.group.conflicts).toHaveLength(2);
    } finally {
      s.db.close();
    }
  });
  it(`${kind} refuses to supersede an Outbox packet with a different entity identity`, async () => {
    const s = await nativeVisualConflictFixture(kind);
    try {
      await s.a.runAsync(
        "UPDATE sync_outbox SET payload_json=? WHERE command_id=?",
        JSON.stringify({ ...s.review.local, id: randomUUID() }),
        s.review.command.commandId,
      );
      const review = await s.review.repo.review(
        s.f.storeId,
        s.review.conflict.id,
        s.f.actorId,
      );
      expect(review.canKeep).toBe(false);
      expect(review.canAdopt).toBe(false);
    } finally {
      s.db.close();
    }
  });
  it(`${kind} retains the acknowledged base and permits explicit review of a newer typed pull`, async () => {
    const s = await nativeVisualConflictFixture(kind);
    try {
      const base = (await s.library.get(kind, s.f.storeId, s.review.local.id))!
          .remoteVersion,
        remote = { ...s.review.remote, version: 3 };
      await applyVisualEntity(s.a, s.f.storeId, kind, remote);
      const current = (await s.library.get(kind, s.f.storeId, remote.id))!;
      expect(current.remoteVersion).toBe(base);
      expect(current.remote!.version).toBe(3);
      const review = await s.review.repo.review(
        s.f.storeId,
        s.review.conflict.id,
        s.f.actorId,
      );
      expect(review.canKeep).toBe(true);
      expect(review.canAdopt).toBe(true);
      expect(review.remote.version).toBe(3);
    } finally {
      s.db.close();
    }
  });
}

type Fixture = Awaited<ReturnType<typeof nativeVisualConflictFixture>>;
async function addRemote(s: Fixture, remote: typeof s.review.remote) {
  const command = await s.outbox.enqueue({
    ...s.review.command,
    commandId: randomUUID(),
  });
  await s.outbox.markSyncing(command.commandId);
  await new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    entityType: s.kind,
    entityId: s.review.local.id,
    status: "CONFLICT",
    remoteVersion: remote.version,
    remoteEntity: remote,
  });
  await s.outbox.markConflict(command.commandId, "VISUAL_VERSION_CONFLICT");
}
function snapshot(s: Fixture) {
  return [
    "visual_assets",
    "visual_identities",
    "product_visual_links",
    "visual_conflict_history",
    "sync_outbox",
    "sync_conflicts",
    "local_jobs",
    "products",
  ].map((table) => s.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
for (const kind of visualConflictKinds)
  for (const mode of ["GROUP", "PULL"] as const)
    it.each([true, false])(
      `${kind} rejects a stale ${mode} review and resolves the latest complete group (local=%s)`,
      async (local) => {
        const s = await nativeVisualConflictFixture(kind);
        try {
          const before = await s.review.repo.review(
              s.scope.storeId,
              s.review.conflict.id,
              s.scope.ownerId,
            ),
            remote = { ...s.review.remote, version: 3 };
          if (mode === "GROUP") await addRemote(s, remote);
          else await applyVisualEntity(s.a, s.scope.storeId, kind, remote);
          const state = snapshot(s);
          await expect(
            s.review.repo.resolve(
              s.scope.storeId,
              s.review.conflict.id,
              local,
              s.context(before.hash),
            ),
          ).rejects.toThrow("STALE");
          expect(snapshot(s)).toEqual(state);
          const review = await s.review.repo.review(
              s.scope.storeId,
              s.review.conflict.id,
              s.scope.ownerId,
            ),
            ctx = s.context(review.hash);
          expect(review.remote).toEqual(remote);
          expect(review.group.conflicts).toHaveLength(mode === "GROUP" ? 2 : 1);
          await s.review.repo.resolve(
            s.scope.storeId,
            s.review.conflict.id,
            local,
            ctx,
          );
          const current = (await s.library.get(
            kind,
            s.scope.storeId,
            remote.id,
          ))!;
          expect(current.entity.version).toBe(local ? 4 : 3);
          expect(current.remoteVersion).toBe(3);
          expect(current.syncState).toBe(local ? "PENDING" : "SYNCED");
          expect(current.entity.createdBy).toBe(remote.createdBy);
          expect(current.entity.createdAt).toBe(remote.createdAt);
          const history = s.db
            .prepare("SELECT * FROM visual_conflict_history WHERE action_id=?")
            .get(ctx.commandId)!;
          expect(JSON.parse(history.local_json as string)).toEqual(
            s.review.local,
          );
          expect(JSON.parse(history.remote_json as string)).toEqual(remote);
          expect(
            await new ConflictRepository(s.a).listOpenForEntity(
              s.scope.storeId,
              kind,
              remote.id,
            ),
          ).toEqual([]);
          const commands = (await s.outbox.listPending(s.scope.storeId)).filter(
            (c) => c.entityType === kind,
          );
          expect(commands).toHaveLength(local ? 1 : 0);
          if (local) expect(commands[0]!.expectedRemoteVersion).toBe(3);
          const old = await s.outbox.getById(s.review.command.commandId);
          expect(old!.payload).toEqual(s.review.command.payload);
          expect(old!.status).toBe("FAILED");
          expect(old!.lastErrorCode).toBe("VISUAL_LIBRARY_SUPERSEDED");
          await expect(
            s.review.repo.resolve(
              s.scope.storeId,
              s.review.conflict.id,
              local,
              ctx,
            ),
          ).rejects.toThrow("SCOPE");
        } finally {
          s.db.close();
        }
      },
    );
for (const kind of visualConflictKinds)
  it.each(["SAME_VERSION", "FOREIGN_LOCAL", "ENVELOPE", "TOO_MANY"] as const)(
    `${kind} refuses a contradictory ${kind} group (%s) without consuming any version`,
    async (mode) => {
      const s = await nativeVisualConflictFixture(kind);
      try {
        if (mode === "SAME_VERSION") {
          const different = { ...s.review.remote, updatedBy: randomUUID() };
          await addRemote(s, different);
        }
        if (mode === "FOREIGN_LOCAL") {
          await addRemote(s, s.review.remote);
          await s.a.runAsync(
            "UPDATE sync_conflicts SET local_payload_json=? WHERE id<>?",
            JSON.stringify({ ...s.review.local, storeId: randomUUID() }),
            s.review.conflict.id,
          );
        }
        if (mode === "ENVELOPE") {
          await addRemote(s, s.review.remote);
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_version=99 WHERE id<>?",
            s.review.conflict.id,
          );
        }
        if (mode === "TOO_MANY")
          for (let n = 0; n < 100; n++) await addRemote(s, s.review.remote);
        const review = await s.review.repo.review(
            s.scope.storeId,
            s.review.conflict.id,
            s.scope.ownerId,
          ),
          before = snapshot(s);
        expect(review.canKeep).toBe(false);
        expect(review.canAdopt).toBe(false);
        await expect(
          s.review.repo.resolve(
            s.scope.storeId,
            s.review.conflict.id,
            false,
            s.context(review.hash),
          ),
        ).rejects.toThrow("STALE");
        expect(snapshot(s)).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
for (const kind of visualConflictKinds)
  it.each(["CALLBACK", "ACTOR", "DEVICE", "SIGNAL", "COMMIT"] as const)(
    `${kind} rolls back the whole choice on %s replacement`,
    async (mode) => {
      const s = await nativeVisualConflictFixture(kind);
      try {
        const review = await s.review.repo.review(
            s.scope.storeId,
            s.review.conflict.id,
            s.scope.ownerId,
          ),
          before = snapshot(s),
          ctx = s.context(review.hash),
          abort = new AbortController();
        let active = true;
        ctx.canResolve = () => active;
        const context = {
          ...ctx,
          signal: abort.signal,
          canResolve: () => active,
        };
        if (mode === "COMMIT") s.a.fail = true;
        s.a.afterRun = (sql) => {
          if (sql.startsWith("UPDATE sync_outbox")) {
            if (mode === "CALLBACK") active = false;
            if (mode === "ACTOR") context.actorId = randomUUID();
            if (mode === "DEVICE") context.deviceId = randomUUID();
            if (mode === "SIGNAL") abort.abort();
          }
        };
        await expect(
          s.review.repo.resolve(
            s.scope.storeId,
            s.review.conflict.id,
            true,
            context,
          ),
        ).rejects.toThrow();
        expect(snapshot(s)).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
