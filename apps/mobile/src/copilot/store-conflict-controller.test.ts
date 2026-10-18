import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { nativeStoreConflictFixture } from "../../../../scripts/test-store-conflict-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotStoreConflictController } from "./store-conflict-controller";
import { readStoreConflictCurrent } from "./store-conflict-review";
import { readStoreConflictProposal } from "@fl-copilot/domain";
import { OutboxRepository } from "../sync/outbox-repository";
it.each([
  ["FIELD_EVENT", "KEEP_LOCAL"],
  ["FIELD_EVENT", "ADOPT_REMOTE"],
  ["SETTINGS", "KEEP_LOCAL"],
  ["SETTINGS", "ADOPT_REMOTE"],
] as const)(
  "resolves %s/%s once offline, preserving history and canonical Outbox after restart",
  async (kind, decision) => {
    const dir = mkdtempSync(join(tmpdir(), "fl-conflict-")),
      path = join(dir, "native.db"),
      s = await nativeStoreConflictFixture(kind, path);
    let reopened: DatabaseSync | undefined;
    try {
      const r = s.review;
      expect(r.state.status).toBe("READY");
      const before = s.db.prepare(`SELECT * FROM ${r.table}`).all(),
        oldHistory = s.count(
          kind === "FIELD_EVENT"
            ? "store_product_event_history"
            : "store_context_history",
        ),
        files = s.count("local_files");
      const result = await r.controller.confirm(
        r.message,
        r.state.review!.basisHash,
        decision,
        true,
      );
      expect(result.status).toBe("COMPLETED");
      expect(
        (await readStoreConflictCurrent(
          s.a,
          readStoreConflictProposal(r.message).content,
        ))!.entity,
      ).toMatchObject(
        decision === "ADOPT_REMOTE"
          ? r.remote
          : kind === "SETTINGS"
            ? { version: 3, schoolZone: "B" }
            : { version: 3, endedAt: "2026-10-09T11:00:00.000Z" },
      );
      const commands = (
        await new OutboxRepository(s.a).listPending(s.scope.storeId)
      ).filter((c) => c.entityType === r.entityType);
      expect(commands).toHaveLength(decision === "KEEP_LOCAL" ? 1 : 0);
      if (commands[0])
        expect(commands[0]).toMatchObject({
          expectedRemoteVersion: 2,
          entityId: r.remote.id,
        });
      expect(
        s.count(
          kind === "FIELD_EVENT"
            ? "store_product_event_history"
            : "store_context_history",
        ),
      ).toBe(oldHistory + 1);
      expect(
        s.db
          .prepare("SELECT status FROM sync_conflicts WHERE id=?")
          .get(r.conflict.id)!.status,
      ).toBe(decision === "KEEP_LOCAL" ? "RESOLVED_LOCAL" : "RESOLVED_REMOTE");
      expect(s.count("sales_observations")).toBe(0);
      expect(s.count("waste_observations")).toBe(0);
      expect(s.count("local_files")).toBe(files);
      expect(before).not.toEqual(
        s.db.prepare(`SELECT * FROM ${r.table}`).all(),
      );
      const after = s.db
        .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
        .all();
      s.db.close();
      reopened = new DatabaseSync(path);
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
            r.state.review!.basisHash,
            decision,
            true,
          )
        ).status,
      ).toBe("COMPLETED");
      expect(
        reopened
          .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
          .all(),
      ).toEqual(after);
      await expect(
        controller.confirm(
          r.message,
          r.state.review!.basisHash,
          decision === "KEEP_LOCAL" ? "ADOPT_REMOTE" : "KEEP_LOCAL",
          true,
        ),
      ).rejects.toThrow();
      r.scope.canCaptureStoreEvents = false;
      r.scope.canManageStoreSettings = false;
      await expect(controller.open(r.message)).rejects.toThrow();
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it.each([
  "PERMISSION",
  "UNCHECKED",
  "LOCAL",
  "REMOTE",
  "NEW_REMOTE",
  "COMMAND",
  "MULTIPLE",
  "DELETED",
  "PARENT_REMOVED",
  "ASSISTANT_REMOVED",
  "ARCHIVED",
  "FOREIGN",
  "FORGED",
  "COMMIT",
  "CANCEL",
])(
  "rejects changed or unauthorized comparisons and rolls back all writes (%s)",
  async (mode) => {
    for (const kind of ["FIELD_EVENT", "SETTINGS"] as const) {
      const s = await nativeStoreConflictFixture(kind);
      try {
        const r = s.review,
          cancel = new AbortController();
        let message = r.message;
        if (mode === "PERMISSION") {
          r.scope.canCaptureStoreEvents = false;
          r.scope.canManageStoreSettings = false;
        }
        if (mode === "LOCAL")
          await s.a.runAsync(
            `UPDATE ${r.table} SET payload_json=json_set(payload_json,'$.version',99) WHERE id=?`,
            r.remote.id,
          );
        if (mode === "REMOTE")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET remote_payload_json=json_set(remote_payload_json,'$.version',99) WHERE id=?",
            r.conflict.id,
          );
        if (mode === "NEW_REMOTE")
          await s.a.runAsync(
            `UPDATE ${r.table} SET remote_version=99 WHERE id=?`,
            r.remote.id,
          );
        if (mode === "COMMAND")
          await s.a.runAsync(
            "UPDATE sync_outbox SET status='SYNCING' WHERE command_id=?",
            r.command.commandId,
          );
        if (mode === "MULTIPLE")
          await s.a.runAsync(
            "INSERT INTO sync_conflicts SELECT ?,store_id,NULL,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at,resolved_at FROM sync_conflicts WHERE id=?",
            randomUUID(),
            r.conflict.id,
          );
        if (mode === "DELETED")
          await s.a.runAsync(
            "DELETE FROM copilot_messages WHERE id=?",
            message.id,
          );
        if (mode === "PARENT_REMOVED")
          await s.a.runAsync(
            "DELETE FROM copilot_messages WHERE id=?",
            s.f.chat.message.id,
          );
        if (mode === "ASSISTANT_REMOVED")
          await s.a.runAsync(
            "DELETE FROM copilot_messages WHERE id=?",
            s.f.assistant.id,
          );
        if (mode === "ARCHIVED")
          await s.a.runAsync(
            "UPDATE copilot_conversations SET payload_json=json_set(payload_json,'$.status','ARCHIVED') WHERE id=?",
            s.f.chat.conversation.id,
          );
        if (mode === "FOREIGN")
          await s.a.runAsync(
            "UPDATE sync_conflicts SET store_id=? WHERE id=?",
            randomUUID(),
            r.conflict.id,
          );
        if (mode === "FORGED")
          message = {
            ...message,
            text: JSON.stringify({
              ...JSON.parse(message.text),
              basis: { ...r.preview.basis, entityId: randomUUID() },
            }),
          };
        const before = s.db.prepare(`SELECT * FROM ${r.table}`).all(),
          outbox = s.db
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
          conflicts = s.db
            .prepare("SELECT * FROM sync_conflicts ORDER BY id")
            .all(),
          history = s.count(
            kind === "FIELD_EVENT"
              ? "store_product_event_history"
              : "store_context_history",
          );
        if (mode === "COMMIT") s.a.fail = true;
        if (mode === "CANCEL")
          s.a.afterRun = (sql) => {
            if (sql.includes("UPDATE sync_conflicts SET status="))
              cancel.abort();
          };
        await expect(
          r.controller.confirm(
            message,
            r.state.review!.basisHash,
            "KEEP_LOCAL",
            mode !== "UNCHECKED",
            cancel.signal,
          ),
        ).rejects.toThrow();
        expect(s.db.prepare(`SELECT * FROM ${r.table}`).all()).toEqual(before);
        expect(
          s.db
            .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence")
            .all(),
        ).toEqual(outbox);
        expect(
          s.db.prepare("SELECT * FROM sync_conflicts ORDER BY id").all(),
        ).toEqual(conflicts);
        expect(s.count("copilot_tool_results")).toBe(0);
        expect(
          s.count(
            kind === "FIELD_EVENT"
              ? "store_product_event_history"
              : "store_context_history",
          ),
        ).toBe(history);
      } finally {
        s.db.close();
      }
    }
  },
);
it("never keeps a changed capture; remote adoption retains the original history", async () => {
  const s = await nativeStoreConflictFixture();
  try {
    const r = s.review;
    await s.a.runAsync(
      "UPDATE store_product_events SET payload_json=json_set(payload_json,'$.comment','capture différente') WHERE id=?",
      r.remote.id,
    );
    const state = await r.controller.open(r.message);
    expect(state.status).toBe("READY");
    expect(state.review!.canKeepLocal).toBe(false);
    await expect(
      r.controller.confirm(
        r.message,
        state.review!.basisHash,
        "KEEP_LOCAL",
        true,
      ),
    ).rejects.toThrow();
    expect(
      (
        await r.controller.confirm(
          r.message,
          state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        )
      ).status,
    ).toBe("COMPLETED");
  } finally {
    s.db.close();
  }
});

it.each(["FIELD_EVENT", "SETTINGS"] as const)(
  "cannot substitute the other family permission for %s",
  async (kind) => {
    const s = await nativeStoreConflictFixture(kind);
    try {
      const r = s.review;
      if (kind === "FIELD_EVENT") r.scope.canCaptureStoreEvents = false;
      else r.scope.canManageStoreSettings = false;
      await expect(r.controller.open(r.message)).rejects.toThrow("FORBIDDEN");
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each(["FIELD_EVENT", "SETTINGS"] as const)(
  "reports a conflict already resolved elsewhere as a no-op (%s)",
  async (kind) => {
    const s = await nativeStoreConflictFixture(kind);
    try {
      const r = s.review;
      await s.a.runAsync(
        "UPDATE sync_conflicts SET status='RESOLVED_REMOTE' WHERE id=?",
        r.conflict.id,
      );
      await s.a.runAsync(
        `UPDATE ${r.table} SET sync_state='SYNCED' WHERE id=?`,
        r.remote.id,
      );
      expect((await r.controller.open(r.message)).status).toBe("UNCHANGED");
      await expect(
        r.controller.confirm(
          r.message,
          r.state.review!.basisHash,
          "ADOPT_REMOTE",
          true,
        ),
      ).rejects.toThrow();
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it("refuses an oversized command history instead of authorizing from a sampled snapshot", async () => {
  const s = await nativeStoreConflictFixture("SETTINGS");
  try {
    for (let n = 0; n < 101; n++)
      await s.a.runAsync(
        "INSERT INTO sync_outbox(command_id,store_id,device_id,local_sequence,command_type,entity_type,entity_id,payload_json,status,attempt_count,created_at) VALUES(?,?,?,?,'STORE_CONTEXT_SETTINGS_UPSERT','store_context_settings',?,?,'FAILED',1,?)",
        randomUUID(),
        s.scope.storeId,
        s.scope.deviceId,
        1000 + n,
        s.review.remote.id,
        JSON.stringify(s.review.remote),
        s.review.remote.updatedAt,
      );
    expect((await s.review.controller.open(s.review.message)).status).toBe(
      "BLOCKED",
    );
    expect(s.count("copilot_tool_results")).toBe(0);
  } finally {
    s.db.close();
  }
});
