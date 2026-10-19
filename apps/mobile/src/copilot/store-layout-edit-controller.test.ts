import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { copilotMessageSchema } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { CopilotStoreLayoutEditController } from "./store-layout-edit-controller";
import {
  StoreLayoutRepository,
  applyStoreLayout,
} from "../store/layout-repository";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import {
  layoutFixture,
  nextLayout,
} from "../../../../scripts/test-store-layout-fixtures";
import { presentStoreLayoutEdit } from "../../../api/src/copilot/store-layout-edit-tool";
import { buildStoreLayoutEditMessages } from "../../../api/src/copilot/store-layout-edit-messages";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("PRIVATE_SQLITE_FAILURE");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
async function setup(path = ":memory:", mobile = false) {
  const db = new DatabaseSync(path),
    a = new Adapter(db),
    f = chatFixture(randomUUID),
    deviceId = randomUUID();
  await runLocalMigrations(a);
  const conversation = new CopilotConversationRepository(a, f);
  await conversation.save(f.conversation, {
    commandId: randomUUID(),
    deviceId,
  });
  await conversation.append(
    { ...f.message, text: "Modifie le plan du magasin.", attachments: [] },
    { commandId: randomUUID(), deviceId },
  );
  const first = layoutFixture(f.storeId, f.ownerId),
    id = randomUUID(),
    head = nextLayout(first, {
      action: "ADOPT_REFERENCE",
      revisionId: id,
      referenceRevisionId: id,
    });
  const input = mobile
    ? {
        action: "ADD_MOBILE",
        expectedRevisionId: head.revisionId,
        label: "Mobile pommes",
        hostId: head.content.furniture[0]!.id,
      }
    : {
        action: "EDIT",
        expectedRevisionId: head.revisionId,
        targetId: null,
        patch: { widthCm: 1140.5 },
      };
  const preview = presentStoreLayoutEdit(f.storeId, input, {
    head,
    reference: head,
  });
  const assistant = copilotMessageSchema.parse({
    ...f.message,
    id: randomUUID(),
    role: "ASSISTANT",
    text: "Modification préparée, à confirmer.",
    attachments: [],
    replyToMessageId: f.message.id,
  });
  const message = buildStoreLayoutEditMessages(assistant, [preview])[0]!;
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyStoreLayout(tx, f.storeId, first);
    await applyStoreLayout(tx, f.storeId, head);
    await applyCopilotRecord(tx, f, "copilot_message", assistant);
    await applyCopilotRecord(tx, f, "copilot_message", message);
  });
  const scope = {
      storeId: f.storeId,
      ownerId: f.ownerId,
      deviceId,
      canManageStoreLayout: true,
    },
    clock = () => "2026-10-19T15:00:00.000Z";
  const controller = new CopilotStoreLayoutEditController(
      a,
      scope,
      randomUUID,
      clock,
    ),
    repo = new StoreLayoutRepository(a, randomUUID, clock);
  const counts = () => ({
    history: db.prepare("SELECT COUNT(*) n FROM store_layout_revisions").get()!
      .n,
    outbox: db
      .prepare(
        "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout'",
      )
      .get()!.n,
    results: db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!.n,
  });
  return {
    db,
    a,
    f,
    scope,
    clock,
    controller,
    repo,
    head,
    message,
    preview,
    counts,
  };
}
it("confirms once offline with unchanged adopted reference, restarts and replays without duplicate history/Outbox/mobile IDs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-layout-chat-")),
    path = join(dir, "local.db"),
    s = await setup(path, true);
  let reopened: DatabaseSync | undefined;
  try {
    expect((await s.controller.open(s.message)).status).toBe("READY");
    expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
    const done = await s.controller.confirm(s.message);
    expect(done.status).toBe("COMPLETED");
    const p = await s.repo.get(s.f.storeId);
    expect(p?.entity.action).toBe("SAVE_DRAFT");
    expect(p?.entity.referenceRevisionId).toBe(s.head.revisionId);
    expect(p?.syncState).toBe("PENDING");
    expect(p?.entity.content.furniture.at(-1)?.id).toBe(
      s.preview.created?.furnitureId,
    );
    expect(p?.entity.content.surfaces.at(-1)?.id).toBe(
      s.preview.created?.surfaceId,
    );
    expect(s.counts()).toEqual({ history: 3, outbox: 1, results: 1 });
    await s.controller.confirm(s.message);
    expect(s.counts()).toEqual({ history: 3, outbox: 1, results: 1 });
    s.db.close();
    reopened = new DatabaseSync(path);
    const a = new Adapter(reopened),
      c = new CopilotStoreLayoutEditController(a, s.scope, randomUUID, s.clock);
    expect((await c.open(s.message)).status).toBe("COMPLETED");
    await c.confirm(s.message);
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout'",
        )
        .get()!.n,
    ).toBe(1);
    expect(
      (
        await new StoreLayoutRepository(a, randomUUID).get(s.f.storeId)
      )?.entity.content.furniture.at(-1)?.id,
    ).toBe(s.preview.created?.furnitureId);
  } finally {
    try {
      s.db.close();
    } catch {
      /* closed for restart */
    }
    reopened?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("does not write on review/dismissal, refuses a stale local edit and keeps that newer intention", async () => {
  const s = await setup();
  try {
    const opened = await s.controller.open(s.message);
    expect(opened.status).toBe("READY");
    expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
    const content = structuredClone(s.head.content);
    content.furniture[0]!.label = "Retouche locale plus récente";
    await s.repo.save(
      {
        storeId: s.f.storeId,
        expectedRevisionId: s.head.revisionId,
        action: "SAVE_DRAFT",
        content,
      },
      {
        commandId: randomUUID(),
        deviceId: s.scope.deviceId,
        actorId: s.f.ownerId,
        canWrite: true,
      },
    );
    const before = s.counts();
    expect((await s.controller.open(s.message)).status).toBe("STALE");
    await expect(s.controller.confirm(s.message)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(s.counts()).toEqual(before);
    expect(
      (await s.repo.get(s.f.storeId))?.entity.content.furniture[0]?.label,
    ).toBe("Retouche locale plus récente");
  } finally {
    s.db.close();
  }
});
it.each(["CONFLICT", "ERROR"])(
  "keeps %s plans and unsent data untouched",
  async (syncState) => {
    const s = await setup();
    try {
      s.db.prepare("UPDATE store_layouts SET sync_state=?").run(syncState);
      expect((await s.controller.open(s.message)).status).toBe("STALE");
      await expect(s.controller.confirm(s.message)).rejects.toThrow();
      expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
    } finally {
      s.db.close();
    }
  },
);
it("rolls back canonical head, immutable history, operation and Outbox when private result persistence fails", async () => {
  const s = await setup();
  try {
    const original = JSON.stringify(await s.repo.get(s.f.storeId));
    s.a.fail = true;
    await expect(s.controller.confirm(s.message)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    s.a.fail = false;
    expect(JSON.stringify(await s.repo.get(s.f.storeId))).toBe(original);
    expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM store_layout_operations").get()!.n,
    ).toBe(0);
    expect((await s.controller.confirm(s.message)).status).toBe("COMPLETED");
  } finally {
    s.db.close();
  }
});
it("rejects role loss, cancellation, a foreign owner and tampered/unsynced private cards without a write", async () => {
  const s = await setup();
  try {
    await expect(
      new CopilotStoreLayoutEditController(
        s.a,
        { ...s.scope, canManageStoreLayout: false },
        randomUUID,
      ).confirm(s.message),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const abort = new AbortController();
    abort.abort();
    await expect(
      s.controller.confirm(s.message, abort.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      new CopilotStoreLayoutEditController(
        s.a,
        { ...s.scope, ownerId: randomUUID() },
        randomUUID,
      ).confirm(s.message),
    ).rejects.toThrow("SCOPE");
    const tampered = structuredClone(s.message),
      payload = JSON.parse(tampered.text);
    payload.input.patch.widthCm = 100;
    tampered.text = JSON.stringify(payload);
    await expect(s.controller.confirm(tampered)).rejects.toThrow("UNAVAILABLE");
    s.db
      .prepare("UPDATE copilot_messages SET sync_state='PENDING' WHERE id=?")
      .run(s.message.id);
    await expect(s.controller.confirm(s.message)).rejects.toThrow(
      "COPILOT_PROPOSAL_UNAVAILABLE",
    );
    expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
  } finally {
    s.db.close();
  }
});
it.each(["ARCHIVED", "DELETED"])(
  "refuses %s conversations and keeps the store reference",
  async (mode) => {
    const s = await setup();
    try {
      const c = structuredClone(s.f.conversation);
      if (mode === "ARCHIVED") c.status = "ARCHIVED";
      else c.deletedMessageIds = [s.f.message.id];
      s.db
        .prepare("UPDATE copilot_conversations SET payload_json=? WHERE id=?")
        .run(JSON.stringify(c), c.id);
      await expect(s.controller.confirm(s.message)).rejects.toThrow();
      expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
      expect((await s.repo.reference(s.f.storeId))?.revisionId).toBe(
        s.head.revisionId,
      );
    } finally {
      s.db.close();
    }
  },
);

it("gives independent offline devices distinct sync commands for the same card, with stable proposed mobile identities", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-layout-devices-")),
    path = join(dir, "a.db"),
    copy = join(dir, "b.db"),
    s = await setup(path, true);
  let aDb: DatabaseSync | undefined, bDb: DatabaseSync | undefined;
  try {
    s.db.close();
    copyFileSync(path, copy);
    aDb = new DatabaseSync(path);
    bDb = new DatabaseSync(copy);
    const a = new Adapter(aDb),
      b = new Adapter(bDb),
      ca = new CopilotStoreLayoutEditController(
        a,
        s.scope,
        randomUUID,
        s.clock,
      ),
      cb = new CopilotStoreLayoutEditController(
        b,
        { ...s.scope, deviceId: randomUUID() },
        randomUUID,
        s.clock,
      );
    await ca.confirm(s.message);
    await cb.confirm(s.message);
    const qa = await a.getFirstAsync<{
        command_id: string;
        payload_json: string;
      }>(
        "SELECT command_id,payload_json FROM sync_outbox WHERE entity_type='store_layout'",
      ),
      qb = await b.getFirstAsync<{ command_id: string; payload_json: string }>(
        "SELECT command_id,payload_json FROM sync_outbox WHERE entity_type='store_layout'",
      );
    expect(qa?.command_id).not.toBe(qb?.command_id);
    for (const db of [a, b]) {
      const head = await new StoreLayoutRepository(db, randomUUID).get(
        s.f.storeId,
      );
      expect(head?.entity.content.furniture.at(-1)?.id).toBe(
        s.preview.created?.furnitureId,
      );
      expect(head?.entity.parentRevisionId).toBe(s.head.revisionId);
    }
    await ca.confirm(s.message);
    await cb.confirm(s.message);
    expect(
      aDb
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout'",
        )
        .get()!.n,
    ).toBe(1);
    expect(
      bDb
        .prepare(
          "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='store_layout'",
        )
        .get()!.n,
    ).toBe(1);
  } finally {
    try {
      s.db.close();
    } catch {
      /* closed before copying */
    }
    aDb?.close();
    bDb?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
