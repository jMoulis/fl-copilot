import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { storeContextSettingsSchema } from "@fl-copilot/domain";
import {
  nativeStoreConflictFixture,
  storeConflictPreview,
} from "../../../../scripts/test-store-conflict-fixtures";
import {
  receiptReviewDigest,
  ReceiptTestDatabase,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { buildStoreConflictMessages } from "../../../api/src/copilot/store-conflict-messages";
import { applyCopilotRecord } from "../copilot/conversation-repository";
import { CopilotStoreConflictController } from "../copilot/store-conflict-controller";
import { ConflictRepository } from "../sync/conflict-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import {
  StoreContextRepository,
  applyStoreContext,
} from "./context-repository";
type Fixture = Awaited<ReturnType<typeof nativeStoreConflictFixture>>;
async function add(
  s: Fixture,
  remote = storeContextSettingsSchema.parse(s.review.remote),
) {
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
    status: "CONFLICT",
    entityType: command.entityType,
    entityId: command.entityId,
    remoteEntity: remote,
    remoteVersion: remote.version,
  });
}
const snapshot = (s: Fixture) =>
  [
    "store_context_settings",
    "sync_conflicts",
    "sync_outbox",
    "store_context_history",
    "sales_observations",
    "waste_observations",
  ].map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
function ctx(s: Fixture, hash: string) {
  return {
    storeId: s.scope.storeId,
    commandId: randomUUID(),
    remoteHistoryId: randomUUID(),
    deviceId: s.scope.deviceId,
    reviewHash: hash,
    canResolve: () => true,
  };
}
for (const channel of ["MANUAL", "CHAT"] as const)
  for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const)
    it(`resolves reviewed settings offline through ${channel}/${decision}, preserving all snapshots and stable commands after restart`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "fl-settings-review-")),
        path = join(dir, "db.sqlite"),
        s = await nativeStoreConflictFixture("SETTINGS", path);
      let reopened: DatabaseSync | undefined;
      try {
        const r = s.review,
          remote = storeContextSettingsSchema.parse(r.remote),
          older = await add(
            s,
            (await new StoreContextRepository(s.a).get(s.scope.storeId))!
              .remote!,
          );
        await s.a.runAsync(
          "UPDATE sync_conflicts SET created_at='2030-01-01T00:00:00.000Z' WHERE id=?",
          older.id,
        );
        await add(s);
        const retained = s.db
            .prepare(
              "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
            )
            .all(),
          repo = new StoreContextRepository(s.a, receiptReviewDigest),
          review = await repo.review(s.scope.storeId, r.conflict.id),
          state = await r.controller.open(r.message);
        expect(review.canResolve).toBe(true);
        expect(review.group.remote).toEqual(remote);
        expect(state.status).toBe("READY");
        const request = ctx(s, review.hash);
        if (channel === "MANUAL")
          await repo.resolve(r.conflict.id, decision === "KEEP_LOCAL", request);
        else
          await r.controller.confirm(
            r.message,
            state.review!.basisHash,
            decision,
            true,
          );
        expect(
          await new ConflictRepository(s.a).listOpen(s.scope.storeId),
        ).toHaveLength(0);
        expect(
          s.db
            .prepare(
              "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
            )
            .all(),
        ).toEqual(retained);
        expect((await repo.get(s.scope.storeId))!.entity.version).toBe(
          decision === "KEEP_LOCAL" ? 3 : 2,
        );
        const pending = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === "store_context_settings");
        expect(pending).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (pending[0])
          expect(pending[0]).toMatchObject({
            expectedRemoteVersion: 2,
            payload: { schoolZone: "B", version: 3 },
          });
        const commands = s.db
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
          history = s.db
            .prepare("SELECT * FROM store_context_history ORDER BY action_id")
            .all();
        s.db.close();
        reopened = new DatabaseSync(path);
        if (channel === "CHAT") {
          const controller = new CopilotStoreConflictController(
            new ReceiptTestDatabase(reopened),
            r.scope,
            receiptReviewDigest,
            randomUUID,
          );
          expect(
            (
              await controller.confirm(
                r.message,
                state.review!.basisHash,
                decision,
                true,
              )
            ).status,
          ).toBe("COMPLETED");
        } else
          await expect(
            new StoreContextRepository(
              new ReceiptTestDatabase(reopened),
              receiptReviewDigest,
            ).resolve(r.conflict.id, decision === "KEEP_LOCAL", request),
          ).rejects.toThrow();
        expect(
          reopened
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
        ).toEqual(commands);
        expect(
          reopened
            .prepare("SELECT * FROM store_context_history ORDER BY action_id")
            .all(),
        ).toEqual(history);
      } finally {
        if (reopened) reopened.close();
        else s.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
it.each([
  "UNKNOWN_ABSENCE",
  "CONTRADICTORY",
  "FOREIGN",
  "ENVELOPE",
  "SYNCING",
  "TOO_MANY",
  "NEWER_VERSION_WITHOUT_SNAPSHOT",
] as const)(
  "refuses an unverified settings comparison without changing any data (%s)",
  async (mode) => {
    const s = await nativeStoreConflictFixture("SETTINGS");
    try {
      const r = s.review,
        remote = storeContextSettingsSchema.parse(r.remote),
        repo = new StoreContextRepository(s.a, receiptReviewDigest);
      if (mode === "UNKNOWN_ABSENCE")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json='null',remote_version=NULL WHERE id=?",
          r.conflict.id,
        );
      if (mode === "CONTRADICTORY")
        await add(s, { ...remote, schoolZone: "C" });
      if (mode === "FOREIGN") {
        const other = randomUUID();
        await add(s, { ...remote, id: other, storeId: other });
      }
      if (mode === "ENVELOPE")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_version=99 WHERE id=?",
          r.conflict.id,
        );
      if (mode === "SYNCING")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
          r.command.commandId,
        );
      if (mode === "TOO_MANY") for (let i = 0; i < 100; i++) await add(s);
      if (mode === "NEWER_VERSION_WITHOUT_SNAPSHOT")
        await s.a.runAsync(
          "UPDATE store_context_settings SET remote_version=99 WHERE id=?",
          r.remote.id,
        );
      const before = snapshot(s),
        review = await repo.review(s.scope.storeId, r.conflict.id);
      expect(review.canResolve).toBe(false);
      if (mode === "FOREIGN")
        expect(review.group.remote?.storeId).toBe(s.scope.storeId);
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      await expect(
        repo.resolve(r.conflict.id, true, ctx(s, review.hash)),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "LOCAL",
  "NEW_PULL",
  "OLDER_SNAPSHOT",
  "NEW_CONFLICT",
  "COMMAND",
  "PERMISSION",
  "CANCEL",
  "COMMIT",
  "FOREIGN_CONTEXT",
] as const)(
  "rolls back a changed settings decision and every related write (%s)",
  async (mode) => {
    const s = await nativeStoreConflictFixture("SETTINGS");
    try {
      const r = s.review,
        repo = new StoreContextRepository(s.a, receiptReviewDigest),
        older = await add(s, (await repo.get(s.scope.storeId))!.remote!),
        review = await repo.review(s.scope.storeId, r.conflict.id),
        request = ctx(s, review.hash),
        cancel = new AbortController();
      expect(review.canResolve).toBe(true);
      if (mode === "LOCAL")
        await s.a.runAsync(
          "UPDATE store_context_settings SET payload_json=json_set(payload_json,'$.version',7) WHERE id=?",
          r.remote.id,
        );
      if (mode === "NEW_PULL")
        await applyStoreContext(s.a, s.scope.storeId, {
          ...r.remote,
          version: 3,
        });
      if (mode === "OLDER_SNAPSHOT")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET local_payload_json=json_set(local_payload_json,'$.schoolZone','A') WHERE id=?",
          older.id,
        );
      if (mode === "NEW_CONFLICT") await add(s);
      if (mode === "COMMAND")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='FAILED' WHERE command_id=?",
          r.command.commandId,
        );
      let allowed = true;
      if (mode === "PERMISSION" || mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("UPDATE sync_conflicts SET status=")) {
            allowed = false;
            if (mode === "CANCEL") cancel.abort();
          }
        };
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "FOREIGN_CONTEXT") request.storeId = randomUUID();
      const before = snapshot(s);
      await expect(
        repo.resolve(r.conflict.id, true, {
          ...request,
          canResolve: () => allowed,
          signal: cancel.signal,
        }),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it.each(["KEEP_LOCAL", "ADOPT_REMOTE"] as const)(
  "requires a fresh comparison after a newer pull and preserves its remote baseline after future sync (%s)",
  async (decision) => {
    const s = await nativeStoreConflictFixture("SETTINGS");
    try {
      const r = s.review,
        repo = new StoreContextRepository(s.a, receiptReviewDigest),
        old = await repo.review(s.scope.storeId, r.conflict.id),
        remote = { ...storeContextSettingsSchema.parse(r.remote), version: 3 };
      await applyStoreContext(s.a, s.scope.storeId, remote);
      const before = snapshot(s);
      await expect(
        repo.resolve(
          r.conflict.id,
          decision === "KEEP_LOCAL",
          ctx(s, old.hash),
        ),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      const message = buildStoreConflictMessages(s.f.assistant, [
        storeConflictPreview("SETTINGS", remote),
      ])[0]!;
      await s.a.withExclusiveTransactionAsync((tx) =>
        applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
      );
      const state = await r.controller.open(message);
      expect(state.status).toBe("READY");
      await r.controller.confirm(
        message,
        state.review!.basisHash,
        decision,
        true,
      );
      expect((await repo.get(s.scope.storeId))!.entity.version).toBe(
        decision === "KEEP_LOCAL" ? 4 : 3,
      );
      const current = (await repo.get(s.scope.storeId))!.entity;
      await applyStoreContext(
        s.a,
        s.scope.storeId,
        { ...current, version: 4 },
        decision === "KEEP_LOCAL" ? 4 : undefined,
      );
      const history = s.db
        .prepare(
          "SELECT payload_json FROM store_context_history WHERE action='RESOLUTION_REMOTE_BASELINE'",
        )
        .get()!;
      expect(JSON.parse(history.payload_json as string)).toEqual(remote);
    } finally {
      s.db.close();
    }
  },
);
