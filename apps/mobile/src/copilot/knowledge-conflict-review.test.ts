import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { nativeKnowledgeConflictFixture } from "../../../../scripts/test-knowledge-conflict-fixtures";
import {
  receiptReviewDigest,
  ReceiptTestDatabase,
} from "../../../../scripts/test-receipt-publication-sqlite";
import {
  CopilotKnowledgeRepository,
  applyKnowledgeRecord,
} from "./knowledge-repository";
import { ConflictRepository } from "../sync/conflict-repository";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import { joinedMutationDatabase } from "../sync/atomic-local-mutation";
import { canDisplayConflict } from "../sync/private-conflict-scope";
const kinds = ["KNOWLEDGE"] as const;
const fixture = (_kind: "KNOWLEDGE", path = ":memory:") =>
  nativeKnowledgeConflictFixture(path);
type Fixture = Awaited<ReturnType<typeof nativeKnowledgeConflictFixture>>;
const histories = { KNOWLEDGE: "sync_conflicts" };
const repository = (
  s: Fixture,
  db: ConstructorParameters<typeof CopilotKnowledgeRepository>[0] = s.a,
  digest = receiptReviewDigest,
) => new CopilotKnowledgeRepository(db, s.review.scope, digest);
const context = (s: Fixture, hash: string) => ({
  ...s.review.scope,
  deviceId: s.scope.deviceId,
  commandId: randomUUID(),
  reviewCaptureId: randomUUID(),
  reviewHash: hash,
  canResolve: () => true,
});
const tables = (s: Fixture) => [
  ...new Set([
    s.review.table,
    histories[s.review.kind],
    "sync_outbox",
    "sales_observations",
    "waste_observations",
    "copilot_messages",
    "copilot_conversations",
  ]),
];
const snapshot = (s: Fixture) =>
  tables(s).map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
const pull = (s: Fixture, remote: unknown) =>
  applyKnowledgeRecord(s.a, s.review.scope, remote);
async function currentEntity(s: Fixture) {
  const row = await s.a.getFirstAsync<{
    payload_json: string;
    remote_version: number;
  }>(
    "SELECT payload_json,remote_version FROM copilot_knowledge WHERE id=? AND store_id=? AND owner_id=?",
    s.review.remote.id,
    s.scope.storeId,
    s.scope.ownerId,
  );
  return {
    entity: JSON.parse(row!.payload_json) as typeof s.review.local,
    remoteVersion: row!.remote_version,
  };
}
async function add(s: Fixture, remote = s.review.remote) {
  const command = await new OutboxRepository(s.a).enqueue({
    ...s.review.command,
    commandId: randomUUID(),
  });
  return new ConflictRepository(s.a).recordPushConflict(command, {
    commandId: command.commandId,
    status: "CONFLICT",
    entityType: s.review.entityType,
    entityId: s.review.remote.id,
    remoteVersion: remote.version,
    remoteEntity: remote,
  });
}
for (const kind of kinds) {
  it.each(["OLDER_GROUP", "NEW_PULL"] as const)(
    `${kind}: old comparison cannot consume a newer baseline (%s), both choices`,
    async (mode) => {
      for (const local of [true, false]) {
        const s = await fixture(kind);
        try {
          const repo = repository(s),
            old = await repo.review(s.review.remote.id),
            remote = { ...s.review.remote, version: 3 };
          if (mode === "OLDER_GROUP") await add(s, remote);
          else await pull(s, remote);
          const before = snapshot(s);
          await expect(
            repo.resolve(s.review.remote.id, local, context(s, old.hash)),
          ).rejects.toThrow("COPILOT_KNOWLEDGE_REVIEW_CHANGED");
          expect(snapshot(s)).toEqual(before);
          const fresh = await repo.review(s.review.remote.id);
          await repo.resolve(s.review.remote.id, local, context(s, fresh.hash));
          const current = await currentEntity(s);
          expect(current.entity.version).toBe(local ? 4 : 3);
          expect(current.remoteVersion).toBe(3);
          const commands = (
            await new OutboxRepository(s.a).listPending(s.scope.storeId)
          ).filter((c) => c.entityType === s.review.entityType);
          expect(commands).toHaveLength(local ? 1 : 0);
          if (commands[0]) expect(commands[0].expectedRemoteVersion).toBe(3);
          expect(
            await new ConflictRepository(s.a).listOpen(s.scope.storeId),
          ).toHaveLength(0);
          const capture = await s.a.getFirstAsync<{
            remote_payload_json: string;
          }>(
            "SELECT remote_payload_json FROM sync_conflicts WHERE entity_type='copilot_knowledge' AND entity_id=? AND conflict_type='COPILOT_KNOWLEDGE_REVIEW_CAPTURE'",
            s.review.remote.id,
          );
          expect(capture?.remote_payload_json).toBe(JSON.stringify(remote));
          expect(s.count("sales_observations")).toBe(0);
          expect(s.count("waste_observations")).toBe(0);
        } finally {
          s.db.close();
        }
      }
    },
  );
  it.each([
    "NULL",
    "ENVELOPE",
    "CONTRADICTION",
    "FOREIGN",
    "SYNCING",
    "EXCESS",
  ] as const)(
    `${kind}: refuses an unverifiable comparison (%s) without losing local work`,
    async (mode) => {
      const s = await fixture(kind);
      try {
        const repo = repository(s),
          old = await repo.review(s.review.remote.id);
        if (mode === "NULL")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_payload_json='null',remote_version=NULL WHERE id=?",
            s.review.conflict.id,
          );
        if (mode === "ENVELOPE")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_version=99 WHERE id=?",
            s.review.conflict.id,
          );
        if (mode === "FOREIGN")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_payload_json=json_set(remote_payload_json,'$.storeId',?) WHERE id=?",
            randomUUID(),
            s.review.conflict.id,
          );
        if (mode === "CONTRADICTION")
          await add(s, {
            ...s.review.remote,
            updatedAt: "2026-10-24T01:00:00.000Z",
          });
        if (mode === "SYNCING")
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
            s.review.command.commandId,
          );
        if (mode === "EXCESS") for (let i = 0; i < 100; i++) await add(s);
        const before = snapshot(s),
          review = await repo.review(s.review.remote.id);
        expect(review.ready).toBe(false);
        expect(review.canKeepLocal).toBe(false);
        expect(review.canAdoptRemote).toBe(false);
        for (const local of [true, false])
          await expect(
            repo.resolve(s.review.remote.id, local, context(s, old.hash)),
          ).rejects.toThrow();
        expect(snapshot(s)).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
  it(`${kind}: resolves all 100 reviewed conflicts without a hundred sends or orphaned rows`, async () => {
    const s = await fixture(kind);
    try {
      for (let i = 0; i < 99; i++)
        await add(s, { ...s.review.remote, version: i + 3 });
      const repo = repository(s),
        review = await repo.review(s.review.remote.id);
      expect(review.group.remote?.version).toBe(101);
      expect(review.ready).toBe(true);
      await repo.resolve(s.review.remote.id, true, context(s, review.hash));
      expect(
        await new ConflictRepository(s.a).listOpen(s.scope.storeId),
      ).toHaveLength(0);
      const pending = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      ).filter((c) => c.entityType === s.review.entityType);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.expectedRemoteVersion).toBe(101);
      expect(
        s.db
          .prepare(
            "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type=? AND status='ACKNOWLEDGED' AND command_id=?",
          )
          .get(s.review.entityType, s.review.command.commandId)!.n,
      ).toBe(0);
      const after = snapshot(s);
      await expect(
        repo.resolve(s.review.remote.id, true, context(s, review.hash)),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(after);
    } finally {
      s.db.close();
    }
  });
  it.each([
    "LOCAL",
    "COMMAND",
    "FOREIGN_CONTEXT",
    "CANCELLED",
    "REVOKED_DURING_HASH",
    "REVOKED_BEFORE_COMMIT",
    "FAILED_COMMIT",
  ] as const)(
    `${kind}: fences decision changes and rolls the whole write back (%s)`,
    async (mode) => {
      const s = await fixture(kind);
      try {
        let authorized = true;
        const normal = repository(s),
          review = await normal.review(s.review.remote.id),
          ctx = { ...context(s, review.hash), canResolve: () => authorized },
          cancel = new AbortController();
        if (mode === "LOCAL")
          await s.a.runAsync(
            `UPDATE ${s.review.table} SET payload_json=json_set(payload_json,'$.updatedAt','2026-10-24T01:30:00.000Z') WHERE id=?`,
            s.review.remote.id,
          );
        if (mode === "COMMAND")
          await s.a.runAsync(
            "UPDATE sync_outbox SET payload_json='{}' WHERE command_id=?",
            s.review.command.commandId,
          );
        if (mode === "FOREIGN_CONTEXT") ctx.storeId = randomUUID();
        if (mode === "CANCELLED") cancel.abort();
        const db =
          mode === "FAILED_COMMIT" || mode === "REVOKED_BEFORE_COMMIT"
            ? {
                ...joinedMutationDatabase(s.a),
                withExclusiveTransactionAsync: async (
                  work: (tx: OutboxDatabase) => Promise<void>,
                ) =>
                  s.a.withExclusiveTransactionAsync(async (tx) => {
                    if (mode === "REVOKED_BEFORE_COMMIT") {
                      const run = tx.runAsync.bind(tx),
                        proxy = {
                          ...joinedMutationDatabase(tx),
                          runAsync: async (
                            sql: string,
                            ...params: (string | number | null)[]
                          ) => {
                            const result = await run(sql, ...params);
                            if (sql.includes("UPDATE sync_conflicts"))
                              authorized = false;
                            return result;
                          },
                        };
                      await work(proxy);
                    } else {
                      await work(tx);
                      throw Error("COMMIT_FAILED");
                    }
                  }),
              }
            : s.a;
        const repo = repository(s, db, async (text) => {
            const result = await receiptReviewDigest(text);
            if (mode === "REVOKED_DURING_HASH") authorized = false;
            return result;
          }),
          before = snapshot(s);
        await expect(
          repo.resolve(s.review.remote.id, true, {
            ...ctx,
            signal: cancel.signal,
          }),
        ).rejects.toThrow();
        expect(snapshot(s)).toEqual(before);
      } finally {
        s.db.close();
      }
    },
  );
}
it.each(["LOCAL", "REMOTE"] as const)(
  "reusing a forgotten private practice needs separate consent (%s)",
  async (forgotten) => {
    const s = await nativeKnowledgeConflictFixture(":memory:", forgotten);
    try {
      const repo = repository(s),
        review = await repo.review(s.review.remote.id),
        local = forgotten === "REMOTE",
        before = snapshot(s);
      await expect(
        repo.resolve(s.review.remote.id, local, context(s, review.hash)),
      ).rejects.toThrow("COPILOT_KNOWLEDGE_REACTIVATION_REQUIRED");
      expect(snapshot(s)).toEqual(before);
      await repo.resolve(s.review.remote.id, local, {
        ...context(s, review.hash),
        reactivateForgotten: true,
      });
      expect((await currentEntity(s)).entity.status).toBe("ACTIVE");
    } finally {
      s.db.close();
    }
  },
);
it.each(["CONFLICT", "ERROR"] as const)(
  "supports a complete verified cache without an old conflict row (%s), never an unknown creation",
  async (state) => {
    for (const local of [true, false]) {
      const s = await nativeKnowledgeConflictFixture();
      try {
        await s.a.runAsync(
          "DELETE FROM sync_conflicts WHERE id=?",
          s.review.conflict.id,
        );
        await s.a.runAsync(
          "UPDATE copilot_knowledge SET sync_state=? WHERE id=?",
          state,
          s.review.remote.id,
        );
        const repo = repository(s),
          review = await repo.review(s.review.remote.id);
        expect(review.ready).toBe(true);
        expect(review.group.conflicts).toHaveLength(0);
        await repo.resolve(s.review.remote.id, local, context(s, review.hash));
        const captured = await s.a.getFirstAsync<{
          remote_payload_json: string;
        }>(
          "SELECT remote_payload_json FROM sync_conflicts WHERE conflict_type='COPILOT_KNOWLEDGE_REVIEW_CAPTURE' AND entity_id=?",
          s.review.remote.id,
        );
        expect(captured?.remote_payload_json).toBe(
          JSON.stringify(s.review.remote),
        );
        expect((await currentEntity(s)).entity.version).toBe(local ? 3 : 2);
      } finally {
        s.db.close();
      }
    }
  },
);
it("refuses missing cache and conflict remote data without resetting the practice or its commands", async () => {
  const s = await nativeKnowledgeConflictFixture();
  try {
    await s.a.runAsync(
      "UPDATE copilot_knowledge SET remote_payload_json=NULL,remote_version=NULL WHERE id=?",
      s.review.remote.id,
    );
    await s.a.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json='null',remote_version=NULL WHERE id=?",
      s.review.conflict.id,
    );
    const repo = repository(s),
      review = await repo.review(s.review.remote.id),
      before = snapshot(s);
    expect(review.ready).toBe(false);
    for (const local of [true, false])
      await expect(
        repo.resolve(s.review.remote.id, local, context(s, review.hash)),
      ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  } finally {
    s.db.close();
  }
});
it("rebases a retained legacy version-one reset only after a verified comparison, preserving UUID and statement", async () => {
  const s = await nativeKnowledgeConflictFixture();
  try {
    await s.a.runAsync(
      "UPDATE copilot_knowledge SET payload_json=json_set(payload_json,'$.version',1) WHERE id=?",
      s.review.remote.id,
    );
    await s.a.runAsync(
      "UPDATE sync_outbox SET payload_json=json_set(payload_json,'$.version',1),expected_remote_version=NULL WHERE command_id=?",
      s.review.command.commandId,
    );
    const repo = repository(s),
      review = await repo.review(s.review.remote.id),
      ctx = context(s, review.hash);
    expect(review.ready).toBe(true);
    await repo.resolve(s.review.remote.id, true, ctx);
    expect((await currentEntity(s)).entity).toMatchObject({
      id: s.review.local.id,
      statement: s.review.local.statement,
      sourceMessageId: s.review.local.sourceMessageId,
      version: 3,
    });
    const pending = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    ).filter((c) => c.entityType === "copilot_knowledge");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.expectedRemoteVersion).toBe(2);
    expect(
      (await new OutboxRepository(s.a).getById(s.review.command.commandId))
        ?.status,
    ).toBe("FAILED");
  } finally {
    s.db.close();
  }
});
it.each([
  "REMOTE_OWNER",
  "COMMAND_OWNER",
  "CONFLICT_OWNER",
  "SOURCE_ID",
  "CACHE_VERSION",
] as const)(
  "rejects a corrupted private identity (%s) and never exposes a foreign remote",
  async (mode) => {
    const s = await nativeKnowledgeConflictFixture();
    try {
      const other = randomUUID(),
        repo = repository(s),
        old = await repo.review(s.review.remote.id);
      if (mode === "REMOTE_OWNER")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json=json_set(remote_payload_json,'$.ownerId',?,'$.confirmedBy',?) WHERE id=?",
          other,
          other,
          s.review.conflict.id,
        );
      if (mode === "COMMAND_OWNER")
        await s.a.runAsync(
          "UPDATE sync_outbox SET payload_json=json_set(payload_json,'$.ownerId',?,'$.confirmedBy',?) WHERE command_id=?",
          other,
          other,
          s.review.command.commandId,
        );
      if (mode === "CONFLICT_OWNER")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET local_payload_json=json_set(local_payload_json,'$.ownerId',?,'$.confirmedBy',?) WHERE id=?",
          other,
          other,
          s.review.conflict.id,
        );
      if (mode === "SOURCE_ID")
        await s.a.runAsync(
          "UPDATE copilot_knowledge SET payload_json=json_set(payload_json,'$.sourceMessageId',?) WHERE id=?",
          other,
          s.review.remote.id,
        );
      if (mode === "CACHE_VERSION")
        await s.a.runAsync(
          "UPDATE copilot_knowledge SET remote_version=99 WHERE id=?",
          s.review.remote.id,
        );
      const before = snapshot(s),
        fresh = await repo.review(s.review.remote.id);
      expect(fresh.ready).toBe(false);
      expect(fresh.group.remote?.ownerId).not.toBe(other);
      for (const local of [true, false])
        await expect(
          repo.resolve(s.review.remote.id, local, context(s, old.hash)),
        ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it("keeps comparison captures private, survives offline restart and refuses a repeated decision", async () => {
  for (const local of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "fl-memory-review-")),
      path = join(dir, "memory.db"),
      s = await nativeKnowledgeConflictFixture(path);
    let reopened: DatabaseSync | undefined;
    try {
      const repo = repository(s),
        review = await repo.review(s.review.remote.id),
        ctx = context(s, review.hash);
      await repo.resolve(s.review.remote.id, local, ctx);
      const capture = await new ConflictRepository(s.a).getById(
        ctx.reviewCaptureId,
      );
      expect(capture?.conflictType).toBe("COPILOT_KNOWLEDGE_REVIEW_CAPTURE");
      expect(capture?.localPayload).toEqual(s.review.local);
      expect(capture?.remotePayload).toEqual(s.review.remote);
      expect(canDisplayConflict(capture!, s.scope.storeId, randomUUID())).toBe(
        false,
      );
      expect(
        canDisplayConflict(capture!, s.scope.storeId, s.scope.ownerId),
      ).toBe(true);
      const before = snapshot(s);
      s.db.close();
      reopened = new DatabaseSync(path);
      const db = new ReceiptTestDatabase(reopened),
        newRepo = new CopilotKnowledgeRepository(
          db,
          s.review.scope,
          receiptReviewDigest,
        );
      expect((await newRepo.list())[0]!.entity.version).toBe(local ? 3 : 2);
      expect(
        await new CopilotKnowledgeRepository(db, {
          ...s.review.scope,
          ownerId: randomUUID(),
        }).list(),
      ).toEqual([]);
      await expect(
        newRepo.resolve(s.review.remote.id, local, ctx),
      ).rejects.toThrow();
      expect(
        tables(s).map((t) =>
          reopened!.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ),
      ).toEqual(before);
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
it("retains the exact pulled baseline after its cache is replaced by the corresponding acknowledged revision", async () => {
  const s = await nativeKnowledgeConflictFixture();
  try {
    const remote = {
      ...s.review.remote,
      version: 3,
      statement: "Pratique distante à comparer",
    };
    await pull(s, remote);
    const repo = repository(s),
      review = await repo.review(s.review.remote.id),
      ctx = context(s, review.hash);
    await repo.resolve(s.review.remote.id, true, ctx);
    const saved = (await currentEntity(s)).entity;
    await applyKnowledgeRecord(s.a, s.review.scope, saved, saved.version);
    const capture = await new ConflictRepository(s.a).getById(
      ctx.reviewCaptureId,
    );
    expect(capture?.remotePayload).toEqual(remote);
    expect((await repo.list())[0]?.remote?.version).toBe(4);
  } finally {
    s.db.close();
  }
});

it("does not let a local comparison capture hide a later server conflict on its resolution command", async () => {
  const s = await nativeKnowledgeConflictFixture();
  try {
    const repo = repository(s),
      review = await repo.review(s.review.remote.id),
      ctx = context(s, review.hash);
    await expect(
      repo.resolve(s.review.remote.id, true, {
        ...ctx,
        reviewCaptureId: ctx.commandId,
      }),
    ).rejects.toThrow("CAPTURE_ID_INVALID");
    await repo.resolve(s.review.remote.id, true, ctx);
    const packet = await new OutboxRepository(s.a).getById(ctx.commandId),
      remote = {
        ...s.review.remote,
        statement: "Autre appareil après comparaison",
        version: 4,
      };
    await new ConflictRepository(s.a).recordPushConflict(packet!, {
      commandId: ctx.commandId,
      status: "CONFLICT",
      entityType: "copilot_knowledge",
      entityId: remote.id,
      remoteVersion: 4,
      remoteEntity: remote,
    });
    await applyKnowledgeRecord(s.a, s.review.scope, remote);
    await s.a.runAsync(
      "UPDATE copilot_knowledge SET sync_state='CONFLICT' WHERE id=?",
      remote.id,
    );
    await s.a.runAsync(
      "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
      ctx.commandId,
    );
    const capture = await new ConflictRepository(s.a).getById(
        ctx.reviewCaptureId,
      ),
      next = await repo.review(remote.id);
    expect(capture?.status).toBe("RESOLVED_LOCAL");
    expect(capture?.remotePayload).toEqual(s.review.remote);
    expect(next.group.conflicts.map((c) => c.id)).toEqual([ctx.commandId]);
    expect(next.group.remote).toEqual(remote);
    await repo.resolve(remote.id, false, context(s, next.hash));
    expect(
      (await new ConflictRepository(s.a).getById(ctx.commandId))?.status,
    ).toBe("RESOLVED_REMOTE");
  } finally {
    s.db.close();
  }
});
