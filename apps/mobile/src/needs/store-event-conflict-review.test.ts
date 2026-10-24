import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  storeProductEventSchema,
  sameStoreEventCapture,
} from "@fl-copilot/domain";
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
  StoreProductEventRepository,
  applyStoreProductEvent,
} from "./store-event-repository";
type Fixture = Awaited<ReturnType<typeof nativeStoreConflictFixture>>;
async function add(
  s: Fixture,
  remote = storeProductEventSchema.parse(s.review.remote),
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
const tables = [
  "store_product_events",
  "store_product_event_history",
  "sync_conflicts",
  "sync_outbox",
  "products",
  "sales_observations",
  "waste_observations",
  "source_documents",
];
const snapshot = (s: Fixture) =>
  tables.map((t) => s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
const context = (s: Fixture, hash: string) => ({
  storeId: s.scope.storeId,
  commandId: randomUUID(),
  remoteHistoryId: randomUUID(),
  deviceId: s.scope.deviceId,
  capturedAt: "2026-10-09T12:00:00.000Z",
  reviewHash: hash,
  canResolve: () => true,
});
for (const channel of ["MANUAL", "CHAT"] as const)
  for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const)
    it(`preserves immutable capture and resolves reviewed field-event groups through ${channel}/${decision}, offline and after restart`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "fl-event-review-")),
        path = join(dir, "db.sqlite"),
        s = await nativeStoreConflictFixture("FIELD_EVENT", path);
      let reopened: DatabaseSync | undefined;
      try {
        const r = s.review,
          repo = new StoreProductEventRepository(s.a, receiptReviewDigest),
          baseline = (await repo.get(s.scope.storeId, r.remote.id))!.remote!;
        const older = await add(s, baseline);
        await add(s);
        await s.a.runAsync(
          "UPDATE sync_conflicts SET created_at='2030-01-01T00:00:00.000Z' WHERE id=?",
          older.id,
        );
        const before = s.db
            .prepare(
              "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
            )
            .all(),
          review = await repo.review(s.scope.storeId, r.conflict.id),
          state = await r.controller.open(r.message),
          request = context(s, review.hash);
        expect(review.ready).toBe(true);
        expect(state.status).toBe("READY");
        expect(review.group.remote).toEqual(r.remote);
        expect(review.products[s.product.id]).toBe(s.product.label);
        if (channel === "MANUAL")
          await repo.resolve(r.conflict.id, decision === "KEEP_LOCAL", request);
        else
          await r.controller.confirm(
            r.message,
            state.review!.basisHash,
            decision,
            true,
          );
        const current = (await repo.get(s.scope.storeId, r.remote.id))!;
        expect(
          sameStoreEventCapture(
            current.entity,
            storeProductEventSchema.parse(r.remote),
          ),
        ).toBe(true);
        expect(current.entity).toMatchObject({
          version: decision === "KEEP_LOCAL" ? 3 : 2,
          endedAt:
            decision === "KEEP_LOCAL"
              ? "2026-10-09T11:00:00.000Z"
              : "2026-10-09T11:30:00.000Z",
        });
        expect(
          await new ConflictRepository(s.a).listOpen(s.scope.storeId),
        ).toHaveLength(0);
        expect(
          s.db
            .prepare(
              "SELECT id,local_payload_json,remote_payload_json FROM sync_conflicts ORDER BY id",
            )
            .all(),
        ).toEqual(before);
        const pending = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === "store_product_event");
        expect(pending).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (pending[0])
          expect(pending[0]).toMatchObject({
            expectedRemoteVersion: 2,
            payload: { endedAt: "2026-10-09T11:00:00.000Z" },
          });
        const after = snapshot(s);
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
            new StoreProductEventRepository(
              new ReceiptTestDatabase(reopened),
              receiptReviewDigest,
            ).resolve(r.conflict.id, decision === "KEEP_LOCAL", request),
          ).rejects.toThrow();
        expect(
          tables.map((t) =>
            reopened!.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        ).toEqual(after);
      } finally {
        if (reopened) reopened.close();
        else s.db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
it.each(["OLDER_GROUP", "NEW_PULL"] as const)(
  "requires fresh consent after a newer field-event version (%s)",
  async (mode) => {
    for (const decision of ["KEEP_LOCAL", "ADOPT_REMOTE"] as const) {
      const s = await nativeStoreConflictFixture("FIELD_EVENT");
      try {
        const r = s.review,
          repo = new StoreProductEventRepository(s.a, receiptReviewDigest),
          old = await repo.review(s.scope.storeId, r.conflict.id),
          remote = {
            ...storeProductEventSchema.parse(r.remote),
            version: 3,
            endedAt: "2026-10-09T11:45:00.000Z",
          };
        if (mode === "OLDER_GROUP") await add(s, remote);
        else await applyStoreProductEvent(s.a, s.scope.storeId, remote);
        const before = snapshot(s);
        await expect(
          repo.resolve(
            r.conflict.id,
            decision === "KEEP_LOCAL",
            context(s, old.hash),
          ),
        ).rejects.toThrow();
        expect(snapshot(s)).toEqual(before);
        expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
        const message = buildStoreConflictMessages(s.f.assistant, [
          storeConflictPreview("FIELD_EVENT", remote),
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
        const current = (await repo.get(s.scope.storeId, r.remote.id))!.entity;
        expect(current.version).toBe(decision === "KEEP_LOCAL" ? 4 : 3);
        expect(sameStoreEventCapture(current, remote)).toBe(true);
        const pending = (
          await new OutboxRepository(s.a).listPending(s.scope.storeId)
        ).filter((c) => c.entityType === "store_product_event");
        expect(pending).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
        if (pending[0]) expect(pending[0].expectedRemoteVersion).toBe(3);
        await applyStoreProductEvent(
          s.a,
          s.scope.storeId,
          { ...current, version: 4 },
          decision === "KEEP_LOCAL" ? 4 : undefined,
        );
        if (mode === "NEW_PULL")
          expect(
            JSON.parse(
              s.db
                .prepare(
                  "SELECT payload_json FROM store_product_event_history WHERE action='RESOLUTION_REMOTE_BASELINE'",
                )
                .get()!.payload_json as string,
            ),
          ).toEqual(remote);
      } finally {
        s.db.close();
      }
    }
  },
);
it.each([
  "NULL",
  "ENVELOPE",
  "CONTRADICTORY_END",
  "REMOTE_CAPTURE_CHANGED",
  "FOREIGN",
  "SYNCING",
  "LIMIT",
] as const)(
  "refuses an unverified field-event group without changing its capture (%s)",
  async (mode) => {
    const s = await nativeStoreConflictFixture("FIELD_EVENT");
    try {
      const r = s.review,
        remote = storeProductEventSchema.parse(r.remote),
        repo = new StoreProductEventRepository(s.a, receiptReviewDigest);
      if (mode === "NULL")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_payload_json='null',remote_version=NULL WHERE id=?",
          r.conflict.id,
        );
      if (mode === "ENVELOPE")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET remote_version=99 WHERE id=?",
          r.conflict.id,
        );
      if (mode === "CONTRADICTORY_END")
        await add(s, { ...remote, endedAt: "2026-10-09T11:45:00.000Z" });
      if (mode === "REMOTE_CAPTURE_CHANGED")
        await add(s, { ...remote, version: 3, comment: "Different capture" });
      if (mode === "FOREIGN") {
        const id = randomUUID();
        await add(s, { ...remote, id, storeId: randomUUID() });
      }
      if (mode === "SYNCING")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
          r.command.commandId,
        );
      if (mode === "LIMIT") for (let i = 0; i < 100; i++) await add(s);
      const before = snapshot(s),
        review = await repo.review(s.scope.storeId, r.conflict.id);
      expect(review.ready).toBe(false);
      expect(review.canKeepLocal).toBe(false);
      expect(review.canAdoptRemote).toBe(false);
      await expect(
        repo.resolve(r.conflict.id, false, context(s, review.hash)),
      ).rejects.toThrow();
      expect(snapshot(s)).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "LOCAL",
  "COMMAND",
  "NEW_CONFLICT",
  "OLD_CAPTURE",
  "PRODUCT_LABEL",
  "AUTHORITY",
  "CANCEL",
  "COMMIT",
  "FOREIGN_CONTEXT",
] as const)(
  "rolls back a changed field-event decision completely (%s)",
  async (mode) => {
    const s = await nativeStoreConflictFixture("FIELD_EVENT");
    try {
      const r = s.review,
        repo = new StoreProductEventRepository(s.a, receiptReviewDigest),
        older = await add(
          s,
          (await repo.get(s.scope.storeId, r.remote.id))!.remote!,
        ),
        review = await repo.review(s.scope.storeId, r.conflict.id),
        request = context(s, review.hash),
        cancel = new AbortController();
      expect(review.ready).toBe(true);
      if (mode === "LOCAL")
        await s.a.runAsync(
          "UPDATE store_product_events SET payload_json=json_set(payload_json,'$.version',7) WHERE id=?",
          r.remote.id,
        );
      if (mode === "COMMAND")
        await s.a.runAsync(
          "UPDATE sync_outbox SET status='FAILED' WHERE command_id=?",
          r.command.commandId,
        );
      if (mode === "NEW_CONFLICT") await add(s);
      if (mode === "OLD_CAPTURE")
        await s.a.runAsync(
          "UPDATE sync_conflicts SET local_payload_json=json_set(local_payload_json,'$.comment','Older evidence changed') WHERE id=?",
          older.id,
        );
      if (mode === "PRODUCT_LABEL")
        await s.a.runAsync(
          "UPDATE products SET label='New product label' WHERE id=?",
          s.product.id,
        );
      let allowed = true;
      if (mode === "AUTHORITY" || mode === "CANCEL")
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
it("does not send a new closure when both reviewed end times already agree", async () => {
  const s = await nativeStoreConflictFixture("FIELD_EVENT");
  try {
    const r = s.review,
      repo = new StoreProductEventRepository(s.a, receiptReviewDigest);
    await s.a.runAsync(
      "UPDATE store_product_events SET payload_json=json_set(payload_json,'$.endedAt',?) WHERE id=?",
      storeProductEventSchema.parse(r.remote).endedAt,
      r.remote.id,
    );
    const review = await repo.review(s.scope.storeId, r.conflict.id);
    expect(review.canKeepLocal).toBe(true);
    await repo.resolve(r.conflict.id, true, context(s, review.hash));
    expect(
      (await new OutboxRepository(s.a).listPending(s.scope.storeId)).filter(
        (c) => c.entityType === "store_product_event",
      ),
    ).toHaveLength(0);
    expect((await repo.get(s.scope.storeId, r.remote.id))!.syncState).toBe(
      "SYNCED",
    );
  } finally {
    s.db.close();
  }
});
it("repairs only from a verified remote capture when local initial fields differ", async () => {
  const s = await nativeStoreConflictFixture("FIELD_EVENT");
  try {
    const r = s.review,
      repo = new StoreProductEventRepository(s.a, receiptReviewDigest);
    await s.a.runAsync(
      "UPDATE store_product_events SET payload_json=json_set(payload_json,'$.comment','Different local capture') WHERE id=?",
      r.remote.id,
    );
    const review = await repo.review(s.scope.storeId, r.conflict.id);
    expect(review.ready).toBe(true);
    expect(review.canKeepLocal).toBe(false);
    expect(review.canAdoptRemote).toBe(true);
    const before = snapshot(s);
    await expect(
      repo.resolve(r.conflict.id, true, context(s, review.hash)),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
    await repo.resolve(r.conflict.id, false, context(s, review.hash));
    expect((await repo.get(s.scope.storeId, r.remote.id))!.entity).toEqual(
      r.remote,
    );
  } finally {
    s.db.close();
  }
});
it("does not turn a reviewed PDF market tension into a physical stockout or a closure", async () => {
  const s = await nativeStoreConflictFixture("FIELD_EVENT");
  try {
    const r = s.review,
      repo = new StoreProductEventRepository(s.a, receiptReviewDigest),
      doc = storeProductEventSchema.parse({
        ...r.remote,
        type: "TENSION",
        status: "TO_REVIEW",
        endedAt: null,
        source: "COMMERCIAL_PDF",
        sourceDocumentId: randomUUID(),
      });
    await s.a.runAsync(
      "UPDATE store_product_events SET payload_json=?,remote_payload_json=? WHERE id=?",
      JSON.stringify(doc),
      JSON.stringify({ ...doc, version: 1 }),
      doc.id,
    );
    await s.a.runAsync(
      "UPDATE sync_conflicts SET remote_payload_json=? WHERE id=?",
      JSON.stringify(doc),
      r.conflict.id,
    );
    const message = buildStoreConflictMessages(s.f.assistant, [
      storeConflictPreview("FIELD_EVENT", doc),
    ])[0]!;
    await s.a.withExclusiveTransactionAsync((tx) =>
      applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
    );
    const state = await r.controller.open(message);
    expect(state.status).toBe("READY");
    expect(state.review?.canKeepLocal).toBe(false);
    expect(state.review?.canAdoptRemote).toBe(true);
    await expect(
      r.controller.confirm(
        message,
        state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow();
    await r.controller.confirm(
      message,
      state.review!.basisHash,
      "ADOPT_REMOTE",
      true,
    );
    expect((await repo.get(s.scope.storeId, doc.id))!.entity).toMatchObject({
      source: "COMMERCIAL_PDF",
      type: "TENSION",
      status: "TO_REVIEW",
      endedAt: null,
    });
    expect(
      (await new OutboxRepository(s.a).listPending(s.scope.storeId)).filter(
        (c) => c.entityType === "store_product_event",
      ),
    ).toHaveLength(0);
  } finally {
    s.db.close();
  }
});
it("does not invent a local end time for an active capture", async () => {
  const s = await nativeStoreConflictFixture("FIELD_EVENT");
  try {
    const r = s.review,
      repo = new StoreProductEventRepository(s.a, receiptReviewDigest);
    await s.a.runAsync(
      "UPDATE store_product_events SET payload_json=json_set(payload_json,'$.status','ACTIVE','$.endedAt',NULL) WHERE id=?",
      r.remote.id,
    );
    const review = await repo.review(s.scope.storeId, r.conflict.id);
    expect(review.ready).toBe(true);
    expect(review.canKeepLocal).toBe(false);
    expect(review.canAdoptRemote).toBe(true);
    const before = snapshot(s);
    await expect(
      repo.resolve(r.conflict.id, true, context(s, review.hash)),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  } finally {
    s.db.close();
  }
});
it("does not read another store's product label or adopt a reassigned remote episode", async () => {
  const s = await nativeStoreConflictFixture("FIELD_EVENT");
  try {
    const r = s.review,
      repo = new StoreProductEventRepository(s.a, receiptReviewDigest),
      other = randomUUID();
    await s.a.runAsync(
      "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at) SELECT ?,?,'FOREIGN SECRET',category,nature,sales_unit,status,version,created_at,updated_at FROM products WHERE id=?",
      other,
      randomUUID(),
      s.product.id,
    );
    await add(s, {
      ...storeProductEventSchema.parse(r.remote),
      version: 3,
      productId: other,
    });
    const review = await repo.review(s.scope.storeId, r.conflict.id);
    expect(review.ready).toBe(false);
    expect(Object.values(review.products)).not.toContain("FOREIGN SECRET");
    const before = snapshot(s);
    await expect(
      repo.resolve(r.conflict.id, false, context(s, review.hash)),
    ).rejects.toThrow();
    expect(snapshot(s)).toEqual(before);
  } finally {
    s.db.close();
  }
});
it("resolves the complete bounded group of one hundred conflicts of one episode without an orphan or replayed closure", async () => {
  const s = await nativeStoreConflictFixture("FIELD_EVENT");
  try {
    for (let i = 0; i < 99; i++) await add(s);
    const repo = new StoreProductEventRepository(s.a, receiptReviewDigest),
      review = await repo.review(s.scope.storeId, s.review.conflict.id);
    expect(review.ready).toBe(true);
    expect(review.group.conflicts).toHaveLength(100);
    await repo.resolve(s.review.conflict.id, true, context(s, review.hash));
    expect(
      await new ConflictRepository(s.a).listOpen(s.scope.storeId),
    ).toHaveLength(0);
    const pending = (
      await new OutboxRepository(s.a).listPending(s.scope.storeId)
    ).filter((c) => c.entityType === "store_product_event");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.expectedRemoteVersion).toBe(2);
  } finally {
    s.db.close();
  }
});
