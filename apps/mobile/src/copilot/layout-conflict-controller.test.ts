import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  readStoreConflictProposal,
  storeConflictV5InputSchema,
  storeConflictInputSchema,
  validateStoreConflictBasis,
} from "@fl-copilot/domain";
import { nativeLayoutChatConflictFixture } from "../../../../scripts/test-layout-chat-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { OutboxRepository } from "../sync/outbox-repository";
import { StoreLayoutRepository } from "../store/layout-repository";

it.each(["KEEP_LOCAL", "ADOPT_REMOTE"] as const)(
  "chat %s uses canonical plan resolution and replays after a real SQLite reopen",
  async (decision) => {
    const dir = mkdtempSync(join(tmpdir(), "layout-chat-")),
      path = join(dir, "local.db"),
      s = await nativeLayoutChatConflictFixture(path);
    let reopened: DatabaseSync | undefined;
    try {
      expect(s.state.status).toBe("READY");
      expect(readStoreConflictProposal(s.message).content.schemaVersion).toBe(
        6,
      );
      expect(s.message.text.length).toBeLessThan(2500);
      expect(s.preview.basis.layout?.revisionId).toBe(
        s.review.remote.revisionId,
      );
      expect(JSON.stringify(s.preview)).not.toMatch(
        /content|assemblies|furniture|surfaces|provenance|width|depth/,
      );
      const tables = [
        "products",
        "product_identifiers",
        "product_aliases",
        "source_documents",
        "source_records",
        "local_files",
        "sales_observations",
        "waste_observations",
        "waste_receipts",
        "waste_lines",
      ];
      const originals = tables.map((t) =>
        s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      );
      const saved = await s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        decision,
        true,
      );
      expect(saved.status).toBe("COMPLETED");
      const after = (await s.repository.get(s.scope.storeId))!;
      expect(after.entity.content).toEqual(
        decision === "KEEP_LOCAL"
          ? s.review.local.content
          : s.review.remote.content,
      );
      expect(after.entity.referenceRevisionId).toBe(
        s.review.remote.referenceRevisionId,
      );
      expect(after.entity.action).toBe(
        decision === "KEEP_LOCAL" ? "SAVE_DRAFT" : s.review.remote.action,
      );
      expect(
        (await new OutboxRepository(s.a).listPending(s.scope.storeId)).filter(
          (x) => x.entityType === "store_layout",
        ),
      ).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
      expect(
        s.db
          .prepare(
            "SELECT status,last_error_code FROM sync_outbox WHERE command_id=?",
          )
          .get(s.review.command.commandId),
      ).toEqual({
        status: "FAILED",
        last_error_code: "STORE_LAYOUT_SUPERSEDED",
      });
      expect(
        s.db
          .prepare(
            "SELECT COUNT(*) n FROM sync_conflicts WHERE status='OPEN' AND entity_type='store_layout'",
          )
          .get()!.n,
      ).toBe(0);
      expect(
        tables.map((t) =>
          s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ),
      ).toEqual(originals);
      const packets = s.db
        .prepare("SELECT * FROM sync_outbox ORDER BY command_id")
        .all();
      s.db.close();
      reopened = new DatabaseSync(path);
      const a = new ReceiptTestDatabase(reopened),
        controller = new CopilotStoreConflictController(
          a,
          s.chatScope,
          receiptReviewDigest,
          randomUUID,
        );
      expect(
        (
          await controller.confirm(
            s.message,
            s.state.review!.basisHash,
            decision,
            true,
          )
        ).result,
      ).toEqual(saved.result);
      expect(
        reopened.prepare("SELECT * FROM sync_outbox ORDER BY command_id").all(),
      ).toEqual(packets);
      await expect(
        controller.confirm(
          s.message,
          s.state.review!.basisHash,
          decision === "KEEP_LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL",
          true,
        ),
      ).rejects.toThrow("DECISION_CHANGED");
      expect(
        (await new StoreLayoutRepository(
          a,
          randomUUID,
          undefined,
          receiptReviewDigest,
        ).get(s.scope.storeId))!.entity,
      ).toEqual(after.entity);
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it("keeps old capability inputs frozen and refuses model-selected store or winner", async () => {
  const s = await nativeLayoutChatConflictFixture();
  try {
    expect(
      storeConflictV5InputSchema.safeParse({
        kind: "STORE_LAYOUT",
        entityId: null,
      }).success,
    ).toBe(false);
    expect(
      storeConflictInputSchema.safeParse({
        kind: "STORE_LAYOUT",
        entityId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      storeConflictInputSchema.safeParse({
        kind: "STORE_LAYOUT",
        entityId: null,
        decision: "KEEP_LOCAL",
      }).success,
    ).toBe(false);
    expect(() =>
      validateStoreConflictBasis(
        randomUUID(),
        s.preview.input,
        s.preview.basis,
      ),
    ).toThrow("SCOPE");
    expect(() =>
      validateStoreConflictBasis(s.scope.storeId, s.preview.input, {
        ...s.preview.basis,
        layout: { ...s.preview.basis.layout, storeId: randomUUID() },
      }),
    ).toThrow("SCOPE");
  } finally {
    s.db.close();
  }
});
it.each([
  "ROLE",
  "OWNER",
  "STORE",
  "DEVICE",
  "REVIEW",
  "HASH",
  "ABORT",
] as const)(
  "refuses %s without changing the plan, packets or history",
  async (scenario) => {
    const s = await nativeLayoutChatConflictFixture();
    try {
      const scope = { ...s.chatScope };
      if (scenario === "ROLE") scope.canManageStoreLayout = false;
      if (scenario === "OWNER") scope.ownerId = randomUUID();
      if (scenario === "STORE") scope.storeId = randomUUID();
      if (scenario === "DEVICE") scope.deviceId = randomUUID();
      const controller = new CopilotStoreConflictController(
          s.a,
          scope,
          receiptReviewDigest,
          randomUUID,
        ),
        abort = new AbortController();
      if (scenario === "ABORT") abort.abort();
      const tables = [
        "store_layouts",
        "store_layout_revisions",
        "store_layout_operations",
        "sync_outbox",
        "sync_conflicts",
        "copilot_tool_results",
      ];
      const snapshot = () =>
          tables.map((t) =>
            s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        before = snapshot();
      await expect(
        controller.confirm(
          s.message,
          scenario === "HASH" ? "0".repeat(64) : s.state.review!.basisHash,
          "KEEP_LOCAL",
          scenario !== "REVIEW",
          abort.signal,
        ),
      ).rejects.toThrow();
      expect(snapshot()).toEqual(before);
    } finally {
      s.db.close();
    }
  },
);
it("rereads the full plan group and supersedes both reviewed packets without a false acknowledgement", async () => {
  const s = await nativeLayoutChatConflictFixture();
  try {
    const outbox = new OutboxRepository(s.a),
      packet = await outbox.enqueue({
        ...s.review.command,
        commandId: randomUUID(),
      });
    await outbox.markSyncing(packet.commandId);
    const { ConflictRepository } = await import("../sync/conflict-repository");
    await new ConflictRepository(s.a).recordPushConflict(packet, {
      commandId: packet.commandId,
      status: "CONFLICT",
      entityType: "store_layout",
      entityId: s.scope.storeId,
      remoteVersion: s.review.remote.version,
      remoteEntity: s.review.remote,
    });
    await outbox.markConflict(
      packet.commandId,
      "STORE_LAYOUT_VERSION_CONFLICT",
    );
    // Creation order and highest-ID tie-breaking need not select the same
    // row when the full group contains equal synchronized versions.
    const ids = s.db
      .prepare(
        "SELECT id FROM sync_conflicts WHERE entity_type='store_layout' ORDER BY id",
      )
      .all();
    await s.a.runAsync(
      "UPDATE sync_conflicts SET created_at=? WHERE id=?",
      "2026-10-24T02:00:00.000Z",
      String(ids[0]!.id),
    );
    await s.a.runAsync(
      "UPDATE sync_conflicts SET created_at=? WHERE id=?",
      "2026-10-24T01:00:00.000Z",
      String(ids[1]!.id),
    );

    await expect(
      s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow("STALE");
    const state = await s.controller.open(s.message);
    expect(state.review?.layoutReview?.group.conflicts).toHaveLength(2);
    expect(state.review!.conflict!.id).toBe(
      state.review!.layoutReview!.anchor.id,
    );
    expect(state.review!.conflict!.id).not.toBe(
      state.review!.layoutReview!.group.conflict!.id,
    );

    await s.controller.confirm(
      s.message,
      state.review!.basisHash,
      "KEEP_LOCAL",
      true,
    );
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) n FROM sync_conflicts WHERE status='OPEN' AND entity_type='store_layout'",
        )
        .get()!.n,
    ).toBe(0);
    for (const id of [packet.commandId, s.review.command.commandId])
      expect((await outbox.getById(id))!.status).toBe("FAILED");
    expect(
      (await outbox.listPending(s.scope.storeId)).filter(
        (x) => x.entityType === "store_layout",
      ),
    ).toHaveLength(1);
  } finally {
    s.db.close();
  }
});
it("rejects a stale synchronized fingerprint after pull and permits a newly proposed current plan comparison", async () => {
  const s = await nativeLayoutChatConflictFixture();
  try {
    const { nextLayout } =
        await import("../../../../scripts/test-store-layout-fixtures"),
      { applyStoreLayout } = await import("../store/layout-repository"),
      { storeConflictPreview } =
        await import("../../../../scripts/test-store-conflict-fixtures"),
      { buildStoreConflictMessages } =
        await import("../../../api/src/copilot/store-conflict-messages"),
      { applyCopilotRecord } = await import("./conversation-repository");
    const remote = nextLayout(s.review.remote);
    await applyStoreLayout(s.a, s.scope.storeId, remote);
    const before = s.db.prepare("SELECT * FROM store_layouts").all();
    await expect(
      s.controller.confirm(
        s.message,
        s.state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow("STALE");
    expect(s.db.prepare("SELECT * FROM store_layouts").all()).toEqual(before);
    const message = buildStoreConflictMessages(s.f.assistant, [
      storeConflictPreview("STORE_LAYOUT", remote),
    ])[0]!;
    await s.a.withExclusiveTransactionAsync((tx) =>
      applyCopilotRecord(tx, s.f.chat, "copilot_message", message),
    );
    const state = await s.controller.open(message);
    expect(state.status).toBe("READY");
    await s.controller.confirm(
      message,
      state.review!.basisHash,
      "KEEP_LOCAL",
      true,
    );
    const kept = (await s.repository.get(s.scope.storeId))!.entity;
    expect(kept.version).toBe(4);
    expect(kept.parentRevisionId).toBe(remote.revisionId);
    expect(kept.action).toBe("SAVE_DRAFT");
    expect(kept.content).toEqual(s.review.local.content);
  } finally {
    s.db.close();
  }
});

it("keeps superseded plan history without blocking a current reviewed choice", async () => {
  const s = await nativeLayoutChatConflictFixture();
  try {
    const outbox = new OutboxRepository(s.a);
    for (let i = 0; i < 105; i++) {
      const packet = await outbox.enqueue({
        ...s.review.command,
        commandId: randomUUID(),
      });
      await s.a.runAsync(
        "UPDATE sync_outbox SET status='FAILED',last_error_code='STORE_LAYOUT_SUPERSEDED' WHERE command_id=?",
        packet.commandId,
      );
    }
    const old = s.db
      .prepare(
        "SELECT * FROM sync_outbox WHERE last_error_code='STORE_LAYOUT_SUPERSEDED' ORDER BY command_id",
      )
      .all();
    const current = await s.controller.open(s.message);
    expect(current.status).toBe("READY");
    expect(current.review!.layoutReview!.commands).toHaveLength(1);
    await s.controller.confirm(
      s.message,
      current.review!.basisHash,
      "ADOPT_REMOTE",
      true,
    );
    expect(
      s.db
        .prepare(
          "SELECT * FROM sync_outbox WHERE command_id<>? AND last_error_code='STORE_LAYOUT_SUPERSEDED' ORDER BY command_id",
        )
        .all(s.review.command.commandId),
    ).toEqual(old);
  } finally {
    s.db.close();
  }
});
