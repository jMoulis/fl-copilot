import { receiveCopilotReply } from "./response-receiver";
import { CopilotLocalChatController } from "./local-chat-controller";
import { MobileSyncService } from "../sync/sync-service";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { runLocalMigrations, localMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { ConflictRepository } from "../sync/conflict-repository";
class Adapter implements OutboxDatabase {
  fail = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("COMMIT_FAILED");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

const command = () => ({ commandId: randomUUID(), deviceId: randomUUID() });
it("creates offline history/draft/attachment references, clears draft atomically on send and survives restart with stable IDs and owner isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-chat_")),
    path = join(dir, "chat.db"),
    f = chatFixture(randomUUID);
  let db = new DatabaseSync(path);
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("NETWORK_DISABLED");
  };
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter, localMigrations.slice(0, 33));
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    await repo.saveDraft(f.conversation.id, {
      text: "brouillon",
      attachments: f.message.attachments,
      updatedAt: f.message.createdAt,
    });
    adapter.fail = true;
    await expect(repo.append(f.message, command())).rejects.toThrow(
      "COMMIT_FAILED",
    );
    expect((await repo.draft(f.conversation.id))?.text).toBe("brouillon");
    adapter.fail = false;
    await repo.append(f.message, command());
    await repo.append(f.message, command());
    expect(await repo.draft(f.conversation.id)).toBeNull();
    expect(
      db.prepare("SELECT count(*) AS n FROM sync_outbox").get(),
    ).toMatchObject({ n: 2 });
    db.close();
    db = new DatabaseSync(path);
    const restored = new CopilotConversationRepository(new Adapter(db), f);
    expect(
      (await restored.messages(f.conversation.id)).messages[0]!.entity,
    ).toEqual(f.message);
    expect((await restored.list())[0]!.entity.id).toBe(f.conversation.id);
    expect(
      await new CopilotConversationRepository(new Adapter(db), {
        ...f,
        ownerId: randomUUID(),
      }).list(),
    ).toEqual([]);
  } finally {
    globalThis.fetch = original;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("paginates equal timestamps by UUID without missing messages and rejects editing/spoofed assistant/foreign parent", async () => {
  const db = new DatabaseSync(":memory:"),
    adapter = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    const ms = [
      f.message,
      { ...f.message, id: randomUUID(), text: "deux" },
      { ...f.message, id: randomUUID(), text: "trois" },
    ];
    for (const m of ms) await repo.append(m, command());
    const first = await repo.messages(f.conversation.id, 2),
      second = await repo.messages(f.conversation.id, 2, first.before!);
    expect(first.hasMore).toBe(true);
    expect(
      new Set([...first.messages, ...second.messages].map((m) => m.entity.id))
        .size,
    ).toBe(3);
    await expect(
      repo.append({ ...f.message, text: "changed" }, command()),
    ).rejects.toThrow("IMMUTABLE");
    await expect(
      repo.append(
        { ...f.message, id: randomUUID(), role: "ASSISTANT" },
        command(),
      ),
    ).rejects.toThrow("ROLE_INVALID");
    await expect(
      repo.append(
        { ...f.message, id: randomUUID(), ownerId: randomUUID() },
        command(),
      ),
    ).rejects.toThrow("SCOPE_INVALID");
  } finally {
    db.close();
  }
});
it("preserves a later local rename during an older acknowledgement and applies the matching revision without losing messages", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a);
    const repo = new CopilotConversationRepository(a, f);
    await repo.save(f.conversation, command());
    const next = { ...f.conversation, title: "Mon titre", version: 2 };
    await repo.save(next, command());
    await applyCopilotRecord(a, f, "copilot_conversation", f.conversation, 1);
    expect((await repo.list())[0]).toMatchObject({
      entity: { title: "Mon titre" },
      syncState: "PENDING",
    });
    await applyCopilotRecord(a, f, "copilot_conversation", next, 2);
    expect((await repo.list())[0]!.syncState).toBe("SYNCED");
  } finally {
    db.close();
  }
});
it("preserves both titles and explicitly reconciles a version conflict without changing immutable message history", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a);
    const repo = new CopilotConversationRepository(a, f),
      ctx = command();
    await repo.save(f.conversation, ctx);
    await repo.append(f.message, command());
    const remote = { ...f.conversation, title: "Autre appareil", version: 2 };
    const cf = await new ConflictRepository(a).recordPushConflict(
      {
        commandId: ctx.commandId,
        storeId: f.storeId,
        deviceId: f.deviceId,
        localSequence: 1,
        commandType: "COPILOT_CONVERSATION_UPSERT",
        entityType: "copilot_conversation",
        entityId: f.conversation.id,
        expectedRemoteVersion: null,
        payload: f.conversation,
        createdAt: f.conversation.createdAt,
        status: "CONFLICT",
        attemptCount: 0,
        lastAttemptAt: null,
        lastErrorCode: null,
      },
      {
        commandId: ctx.commandId,
        status: "CONFLICT",
        entityType: "copilot_conversation",
        entityId: f.conversation.id,
        remoteVersion: 2,
        remoteEntity: remote,
      },
    );
    await a.runAsync(
      "UPDATE copilot_conversations SET sync_state='CONFLICT' WHERE id=?",
      f.conversation.id,
    );
    await repo.resolve(cf.id, true, command());
    expect((await repo.list())[0]!.entity).toMatchObject({
      title: f.conversation.title,
      version: 3,
    });
    expect(
      (await repo.messages(f.conversation.id)).messages[0]!.entity,
    ).toEqual(f.message);
  } finally {
    db.close();
  }
});

it("bootstraps a capable second device, pulls server-authored history and rejects foreign owners transactionally", async () => {
  const db = new DatabaseSync(":memory:"),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  try {
    await runLocalMigrations(a);
    const snapshot: BootstrapResponse = {
      protocolVersion: 1,
      store: { id: f.storeId },
      snapshotRevision: "test",
      cursor: "snapshot",
      historyPolicy: { rawObservationDays: 90 },
      serverTime: f.message.createdAt,
      entities: {
        syncTestEntities: [],
        products: [],
        productIdentifiers: [],
        productAliases: [],
        needUnits: [],
        needMemberships: [],
        productSubstitutions: [],
        salesObservations: [],
        wasteObservations: [],
        commercialOperations: [],
        offers: [],
        marketSignals: [],
        executionInstructions: [],
        storeEvents: [],
        productDailyPerformance: [],
        departmentDailyPerformance: [],
        recommendations: [],
        decisions: [],
        actionExecutions: [],
        copilotHistoryOwnerId: f.ownerId,
        copilotConversations: [f.conversation],
        copilotMessages: [f.message],
        copilotHistoryPartial: true,
      },
    };
    const reply = {
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      text: "Proposition non exécutée",
      attachments: [],
      replyToMessageId: f.message.id,
      createdAt: "2026-10-11T12:01:00.000Z",
    };
    const sync = new MobileSyncService(
      a,
      {
        bootstrap: async () => snapshot,
        push: async () => ({ results: [], serverTime: f.message.createdAt }),
        pull: async () => ({
          changes: [
            {
              sequence: "2",
              entityType: "copilot_message",
              entityId: reply.id,
              entityVersion: 1,
              operation: "UPSERT",
              entity: reply,
              changedAt: reply.createdAt,
            },
          ],
          nextCursor: "next",
          hasMore: false,
          serverTime: reply.createdAt,
        }),
      },
      {
        appVersion: "test",
        deviceId: f.deviceId,
        copilotHistory: true,
        copilotOwnerId: f.ownerId,
      },
    );
    await sync.sync(f.storeId);
    const repo = new CopilotConversationRepository(a, f);
    expect(
      (await repo.messages(f.conversation.id)).messages.map(
        (m) => m.entity.role,
      ),
    ).toEqual(["USER", "ASSISTANT"]);
    await expect(
      applyCopilotRecord(
        a,
        { ...f, ownerId: randomUUID() },
        "copilot_message",
        reply,
      ),
    ).rejects.toThrow("SCOPE_INVALID");
    expect(
      db.prepare("SELECT count(*) AS n FROM sync_outbox").get(),
    ).toMatchObject({ n: 0 });
  } finally {
    db.close();
  }
});

it("serializes draft edits/send, keeps failed drafts, and restores local questions", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter, localMigrations.slice(0, 36));
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    await repo.saveDraft(f.conversation.id, {
      text: "Avant migration",
      attachments: [],
      updatedAt: f.message.createdAt,
    });
    await runLocalMigrations(adapter);
    expect((await repo.draft(f.conversation.id))!.text).toBe("Avant migration");
    const controller = new CopilotLocalChatController(
      repo,
      f,
      randomUUID,
      () => f.message.createdAt,
    );
    const conversation = await controller.create("Analyser les ventes");
    const edit = controller.edit(conversation.id, {
      text: "Ma question",
      attachments: [],
    });
    const send = controller.send(conversation.id);
    await edit;
    const message = await send;
    expect(message.text).toBe("Ma question");
    const queued = (await controller.open(conversation.id)).pendingTurns;
    expect(queued).toHaveLength(1);
    expect(queued[0]!.userMessageId).toBe(message.id);
    expect((await controller.open(conversation.id)).draft).toBeNull();
    expect(
      (await controller.open(conversation.id)).messages[0]!.entity.id,
    ).toBe(message.id);
    await expect(controller.send(conversation.id)).rejects.toThrow(
      "COPILOT_DRAFT_EMPTY",
    );
    await controller.edit(conversation.id, {
      text: "Question suivante",
      attachments: [],
    });
    adapter.fail = true;
    await expect(controller.send(conversation.id)).rejects.toThrow(
      "COMMIT_FAILED",
    );
    adapter.fail = false;
    expect((await controller.open(conversation.id)).draft!.text).toBe(
      "Question suivante",
    );
    const restored = new CopilotLocalChatController(
      new CopilotConversationRepository(adapter, f),
      f,
      randomUUID,
    );
    expect((await restored.open(conversation.id)).pendingTurns).toEqual(queued);
    await restored.send(conversation.id);
    expect((await restored.open(conversation.id)).messages).toHaveLength(2);
    await receiveCopilotReply(adapter, f, queued[0]!, {
      message: {
        ...message,
        id: queued[0]!.replyId,
        role: "ASSISTANT",
        text: "Réponse enregistrée",
        replyToMessageId: message.id,
      },
      alreadyApplied: false,
    });
    const remaining = (await restored.open(conversation.id)).pendingTurns;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.replyId).not.toBe(queued[0]!.replyId);
    const foreign = { ...f, ownerId: randomUUID() };
    await expect(
      new CopilotLocalChatController(
        new CopilotConversationRepository(adapter, foreign),
        foreign,
        randomUUID,
      ).open(conversation.id),
    ).rejects.toThrow("COPILOT_CONVERSATION_UNAVAILABLE");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_message'",
        )
        .get()!.n,
    ).toBe(2);
  } finally {
    db.close();
  }
});

it("receives a scoped server reply atomically without creating a second Outbox command", async () => {
  const db = new DatabaseSync(":memory:"),
    f = chatFixture(randomUUID);
  try {
    const adapter = new Adapter(db);
    await runLocalMigrations(adapter);
    const repo = new CopilotConversationRepository(adapter, f);
    await repo.save(f.conversation, command());
    await repo.append(f.message, command());
    const message = {
      ...f.message,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      text: "Les données sont disponibles.",
      attachments: [],
      replyToMessageId: f.message.id,
    };
    const request = {
      replyId: message.id,
      conversationId: f.conversation.id,
      userMessageId: f.message.id,
    };
    adapter.fail = true;
    await expect(
      receiveCopilotReply(adapter, f, request, {
        message,
        alreadyApplied: false,
      }),
    ).rejects.toThrow("COMMIT_FAILED");
    adapter.fail = false;
    expect((await repo.messages(f.conversation.id)).messages).toHaveLength(1);
    await receiveCopilotReply(adapter, f, request, {
      message,
      alreadyApplied: false,
    });
    await receiveCopilotReply(adapter, f, request, {
      message,
      alreadyApplied: true,
    });
    const page = await repo.messages(f.conversation.id);
    expect(page.messages).toHaveLength(2);
    expect(
      page.messages.find((m) => m.entity.id === message.id)!.syncState,
    ).toBe("SYNCED");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type='copilot_message'",
        )
        .get()!.n,
    ).toBe(1);
    await expect(
      receiveCopilotReply(adapter, f, request, {
        message: { ...message, ownerId: randomUUID() },
        alreadyApplied: false,
      }),
    ).rejects.toThrow("COPILOT_REPLY_SCOPE_INVALID");
  } finally {
    db.close();
  }
});
