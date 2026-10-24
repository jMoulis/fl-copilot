import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { nativeLayoutConflictFixture } from "../../../../scripts/test-layout-conflict-fixtures";
import { nextLayout } from "../../../../scripts/test-store-layout-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { storeLayoutSchema } from "@fl-copilot/domain";
import { StoreLayoutRepository, applyStoreLayout } from "./layout-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
type Fixture = Awaited<ReturnType<typeof nativeLayoutConflictFixture>>;
const fixtures: Fixture[] = [];
async function setup(path = ":memory:") {
  const s = await nativeLayoutConflictFixture(path);
  fixtures.push(s);
  return s;
}
afterEach(() => {
  for (const s of fixtures.splice(0)) {
    try {
      s.db.close();
    } catch {
      /* deliberately reopened */
    }
  }
});
const tables = [
  "store_layouts",
  "store_layout_revisions",
  "store_layout_operations",
  "sync_outbox",
  "sync_conflicts",
];
const snapshot = (s: Fixture) =>
  tables.map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
const choice = (s: Fixture, local: boolean, remote = s.review.remote) => ({
  useLocal: local,
  storeId: s.scope.storeId,
  localRevisionId: s.review.local.revisionId,
  remoteRevisionId: remote.revisionId,
});
const context = (s: Fixture, hash: string) => ({
  ...s.context,
  commandId: randomUUID(),
  reviewHash: hash,
  canResolve: () => true,
});
async function add(s: Fixture, remote = s.review.remote) {
  const command = await new OutboxRepository(s.a).enqueue({
    ...s.review.command,
    commandId: randomUUID(),
  });
  await s.a.runAsync(
    "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    command.commandId,
  );
  return new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    entityId: remote.id,
    entityType: "store_layout",
    status: "CONFLICT",
    remoteEntity: remote,
    remoteVersion: remote.version,
  });
}
for (const local of [true, false]) {
  it(`resolves the complete latest plan group, journals the decision and replays after restart (local=${local})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "fl-layout-choice-")),
      path = join(dir, "device.db"),
      s = await setup(path);
    let reopened: DatabaseSync | undefined;
    try {
      const latest = nextLayout(s.review.remote);
      await add(s);
      await add(s, latest);
      await applyStoreLayout(s.a, s.scope.storeId, latest);
      const review = await s.repository.review(
          s.scope.storeId,
          s.review.conflict.id,
          s.scope.ownerId,
        ),
        ctx = context(s, review.hash),
        retained = s.db
          .prepare(
            "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
          )
          .all();
      expect(review.canResolve).toBe(true);
      // The acknowledged base is deliberately older than the cached current plan.
      expect((await s.repository.get(s.scope.storeId))!.remoteVersion).toBe(1);
      expect(review.remote).toEqual(latest);
      const result = await s.repository.resolve(
        s.review.conflict.id,
        choice(s, local, latest),
        ctx,
      );
      expect(result.version).toBe(local ? 4 : 3);
      expect(result.content).toEqual(
        local ? s.review.local.content : latest.content,
      );
      expect(result.action).toBe("SAVE_DRAFT");
      expect(result.referenceRevisionId).toBe(latest.referenceRevisionId);
      expect(result.createdAt).toBe(latest.createdAt);
      expect(
        s.db
          .prepare(
            "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
          )
          .all(),
      ).toEqual(retained);
      expect(
        await new ConflictRepository(s.a).listOpen(s.scope.storeId),
      ).toEqual([]);
      const pending = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      ).filter((c) => c.entityType === "store_layout");
      expect(pending).toHaveLength(local ? 1 : 0);
      if (pending[0])
        expect(pending[0]).toMatchObject({
          commandId: ctx.commandId,
          expectedRemoteVersion: 3,
          payload: result,
        });
      const history = await s.repository.history(s.scope.storeId);
      expect(
        history.some(
          (h) => h.revision.id === s.review.local.revisionId && !h.synced,
        ),
      ).toBe(true);
      expect(
        history.some((h) => h.revision.id === latest.revisionId && h.synced),
      ).toBe(true);
      const before = snapshot(s);
      expect(
        await s.repository.resolve(
          s.review.conflict.id,
          choice(s, local, latest),
          ctx,
        ),
      ).toEqual(result);
      expect(snapshot(s)).toEqual(before);
      await expect(
        s.repository.resolve(
          s.review.conflict.id,
          choice(s, !local, latest),
          ctx,
        ),
      ).rejects.toThrow("COMMAND_REUSED");
      s.db.close();
      reopened = new DatabaseSync(path);
      const repo = new StoreLayoutRepository(
        new ReceiptTestDatabase(reopened),
        randomUUID,
        undefined,
        receiptReviewDigest,
      );
      expect((await repo.get(s.scope.storeId))!.entity).toEqual(result);
      expect(
        await repo.resolve(s.review.conflict.id, choice(s, local, latest), ctx),
      ).toEqual(result);
    } finally {
      reopened?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  for (const change of [
    "GROUP",
    "PULL",
    "ENVELOPE",
    "LOCAL",
    "COMMAND",
  ] as const)
    it(`rejects an old comparison after ${change}, without changing any plan/packet (local=${local})`, async () => {
      const s = await setup(),
        review = await s.repository.review(
          s.scope.storeId,
          s.review.conflict.id,
          s.scope.ownerId,
        );
      if (change === "GROUP") await add(s, nextLayout(s.review.remote));
      if (change === "PULL")
        await applyStoreLayout(
          s.a,
          s.scope.storeId,
          nextLayout(s.review.remote),
        );
      if (change === "ENVELOPE")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_version=99 WHERE id=?",
          s.review.conflict.id,
        );
      if (change === "LOCAL")
        await s.a.runAsync(
          "UPDATE store_layouts SET payload_json=? WHERE id=?",
          JSON.stringify(nextLayout(s.review.local)),
          s.scope.storeId,
        );
      if (change === "COMMAND") await add(s);
      const before = snapshot(s);
      await expect(
        s.repository.resolve(
          s.review.conflict.id,
          choice(s, local),
          context(s, review.hash),
        ),
      ).rejects.toThrow("SOURCE_CHANGED");
      expect(snapshot(s)).toEqual(before);
    });
  for (const defect of [
    "ENVELOPE",
    "FOREIGN_LOCAL",
    "FOREIGN_COMMAND",
    "WRONG_ID",
    "HISTORY",
    "CANONICAL_PARENT",
    "CANONICAL_CREATION",
    "SYNCING",
    "LIMIT",
  ] as const)
    it(`refuses a fresh but invalid plan comparison: ${defect} (local=${local})`, async () => {
      const s = await setup();
      if (defect === "ENVELOPE")
        await s.a.runAsync("UPDATE sync_conflicts SET remote_version=99");
      if (defect === "FOREIGN_LOCAL")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET local_payload_json=?",
          JSON.stringify({ ...s.review.local, updatedBy: randomUUID() }),
        );
      if (defect === "FOREIGN_COMMAND")
        await s.a.runAsync(
          "UPDATE sync_outbox SET payload_json=? WHERE command_id=?",
          JSON.stringify({ ...s.review.local, updatedBy: randomUUID() }),
          s.review.command.commandId,
        );
      if (defect === "WRONG_ID")
        await s.a.runAsync(
          "UPDATE sync_outbox SET entity_id=? WHERE command_id=?",
          randomUUID(),
          s.review.command.commandId,
        );
      if (defect === "HISTORY")
        await s.a.runAsync(
          "UPDATE store_layout_revisions SET payload_json=? WHERE id=?",
          JSON.stringify({
            id: s.review.local.revisionId,
            storeId: s.scope.storeId,
            version: 1,
            plan: { ...s.review.local, updatedBy: randomUUID() },
          }),
          s.review.local.revisionId,
        );
      if (defect === "CANONICAL_PARENT")
        await add(
          s,
          nextLayout(s.review.remote, { parentRevisionId: randomUUID() }),
        );
      if (defect === "CANONICAL_CREATION")
        await add(
          s,
          nextLayout(s.review.remote, {
            createdAt: "2026-10-18T12:00:00.000Z",
          }),
        );
      if (defect === "SYNCING")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
          s.review.command.commandId,
        );
      if (defect === "LIMIT") for (let i = 0; i < 100; i++) await add(s);
      const review = await s.repository.review(
          s.scope.storeId,
          s.review.conflict.id,
          s.scope.ownerId,
        ),
        before = snapshot(s);
      expect(review.canResolve).toBe(false);
      await expect(
        s.repository.resolve(
          s.review.conflict.id,
          choice(s, local, review.remote ?? s.review.remote),
          context(s, review.hash),
        ),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    });
  for (const mode of [
    "ACTOR",
    "DEVICE",
    "CANCEL",
    "AFTER_READ",
    "AFTER_WRITE",
    "COMMIT",
  ] as const)
    it(`rolls back the whole choice when its context or transaction fails at ${mode} (local=${local})`, async () => {
      const s = await setup(),
        review = await s.repository.review(
          s.scope.storeId,
          s.review.conflict.id,
          s.scope.ownerId,
        ),
        before = snapshot(s),
        abort = new AbortController();
      let current = true;
      if (mode === "CANCEL") abort.abort();
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "AFTER_WRITE")
        s.a.afterRun = (sql) => {
          if (sql.includes("UPDATE store_layouts SET payload_json="))
            current = false;
        };
      const repo =
        mode === "AFTER_READ"
          ? new StoreLayoutRepository(s.a, randomUUID, undefined, async (v) => {
              current = false;
              return receiptReviewDigest(v);
            })
          : s.repository;
      await expect(
        repo.resolve(s.review.conflict.id, choice(s, local), {
          ...context(s, review.hash),
          signal: abort.signal,
          canResolve: () => current,
          ...(mode === "ACTOR" ? { actorId: randomUUID() } : {}),
          ...(mode === "DEVICE" ? { deviceId: randomUUID() } : {}),
        }),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    });
}
it("normal draft edits also roll back if native authority changes during their write", async () => {
  const s = await setup();
  await s.a.runAsync("UPDATE store_layouts SET sync_state='PENDING'");
  const before = snapshot(s);
  let current = true;
  s.a.afterRun = (sql) => {
    if (sql.includes("INSERT INTO sync_outbox")) current = false;
  };
  await expect(
    s.repository.save(
      {
        storeId: s.scope.storeId,
        action: "SAVE_DRAFT",
        expectedRevisionId: s.review.local.revisionId,
        content: s.review.local.content,
      },
      { ...s.context, commandId: randomUUID() },
      { canResolve: () => current },
    ),
  ).rejects.toThrow("AUTHORITY_CHANGED");
  expect(snapshot(s)).toEqual(before);
});
it("preserves distinct concurrent roots while rebasing a local draft on the canonical creation anchor", async () => {
  const s = await setup(),
    remote = storeLayoutSchema.parse({
      ...s.base,
      revisionId: randomUUID(),
      createdAt: "2026-10-18T12:00:00.000Z",
    });
  await s.a.runAsync(
    "UPDATE sync_conflicts SET remote_payload_json=?,remote_version=1",
    JSON.stringify(remote),
  );
  await s.a.runAsync(
    "UPDATE store_layouts SET remote_payload_json=?",
    JSON.stringify(remote),
  );
  const review = await s.repository.review(
    s.scope.storeId,
    s.review.conflict.id,
    s.scope.ownerId,
  );
  expect(review.canResolve).toBe(true);
  const result = await s.repository.resolve(
    s.review.conflict.id,
    choice(s, true, remote),
    context(s, review.hash),
  );
  expect(result.createdAt).toBe(remote.createdAt);
  expect(result.content).toEqual(s.review.local.content);
  expect(result.parentRevisionId).toBe(remote.revisionId);
});
it.each([true, false])(
  "retains a canonical reference pointer and unconfirmed measurements without adopting a local draft (local=%s)",
  async (local) => {
    const s = await setup(),
      revisionId = randomUUID(),
      remote = storeLayoutSchema.parse({
        ...s.review.remote,
        revisionId,
        action: "ADOPT_REFERENCE",
        referenceRevisionId: revisionId,
      });
    await s.a.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json=?",
      JSON.stringify(remote),
    );
    await s.a.runAsync(
      "UPDATE store_layouts SET remote_payload_json=?",
      JSON.stringify(remote),
    );
    const review = await s.repository.review(
      s.scope.storeId,
      s.review.conflict.id,
      s.scope.ownerId,
    );
    expect(review.canResolve).toBe(true);
    const result = await s.repository.resolve(
      s.review.conflict.id,
      choice(s, local, remote),
      context(s, review.hash),
    );
    expect(result.referenceRevisionId).toBe(revisionId);
    expect(result.action).toBe(local ? "SAVE_DRAFT" : "ADOPT_REFERENCE");
    expect(result.content).toEqual(
      local ? s.review.local.content : remote.content,
    );
    expect(await s.repository.reference(s.scope.storeId)).toEqual(remote);
  },
);
it("does not overwrite another actor's unsent draft through normal editing", async () => {
  const s = await setup();
  await s.a.runAsync("UPDATE store_layouts SET sync_state='PENDING'");
  const before = snapshot(s);
  await expect(
    s.repository.save(
      {
        storeId: s.scope.storeId,
        action: "SAVE_DRAFT",
        expectedRevisionId: s.review.local.revisionId,
        content: s.review.local.content,
      },
      { ...s.context, actorId: randomUUID(), commandId: randomUUID() },
    ),
  ).rejects.toThrow("AUTHORITY_CHANGED");
  expect(snapshot(s)).toEqual(before);
});
