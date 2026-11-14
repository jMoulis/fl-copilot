import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MercalysTestDatabase } from "../../../../scripts/test-mercalys-sync-fixtures";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { runLocalMigrations } from "../db/migrations";
import {
  CopilotConversationRepository,
  applyCopilotRecord,
} from "./conversation-repository";
import {
  CopilotKnowledgeRepository,
  applyKnowledgeRecord,
} from "./knowledge-repository";
import { buildKnowledgeSuggestionMessages } from "../../../api/src/copilot/knowledge-suggestion-messages";
import {
  captureAutomaticMemories,
  readAutomaticMemory,
  setAutomaticMemory,
} from "./automatic-memory";

const activation = "2026-10-10T00:00:00.000Z";
const now = "2026-10-15T12:00:00.000Z";
async function fixture() {
  const db = new MercalysTestDatabase();
  await runLocalMigrations(db);
  const f = chatFixture(randomUUID),
    scope = { storeId: f.storeId, ownerId: f.ownerId };
  const repo = new CopilotConversationRepository(db, scope);
  await repo.save(f.conversation, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  const source = {
    ...f.message,
    text: "Je prépare mes TG chaque mardi.",
    attachments: [],
  };
  await repo.append(source, { commandId: randomUUID(), deviceId: f.deviceId });
  async function proposal() {
    const assistant = {
      ...source,
      id: randomUUID(),
      role: "ASSISTANT" as const,
      replyToMessageId: source.id,
      text: "Une habitude utile.",
    };
    const candidate = buildKnowledgeSuggestionMessages(
      assistant,
      [
        {
          statement: source.text,
          sources: [{ messageId: source.id, quote: source.text }],
        },
      ],
      {
        memorySuggestion: { currentUserMessageId: source.id, automatic: true },
        userQuestion: source.text,
      } as Parameters<typeof buildKnowledgeSuggestionMessages>[2],
    )[0]!;
    await applyCopilotRecord(db, scope, "copilot_message", assistant);
    await applyCopilotRecord(db, scope, "copilot_message", candidate);
    return candidate;
  }
  const candidate = await proposal();
  const ctx = {
    deviceId: f.deviceId,
    now,
    uuid: randomUUID,
    canCapture: () => true,
  };
  return {
    db,
    f,
    scope,
    repo,
    source,
    candidate,
    proposal,
    ctx,
    knowledge: new CopilotKnowledgeRepository(db, scope),
  };
}

it("automatically saves a sourced practice and one canonical Outbox command, deduplicates subsequent proposals and preserves forgetting", async () => {
  const f = await fixture();
  try {
    await readAutomaticMemory(f.db, f.scope, activation);
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(1);
    const first = (await f.knowledge.list())[0]!;
    expect(first.entity).toMatchObject({
      statement: f.source.text,
      captureMode: "AUTOMATIC",
      sourceMessageId: f.source.id,
      confirmedBy: f.scope.ownerId,
      version: 1,
    });
    expect(first.syncState).toBe("PENDING");
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    await f.proposal();
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    expect(await f.knowledge.list()).toHaveLength(1);
    expect(
      (await f.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='copilot_knowledge'",
      ))!.n,
    ).toBe(1);
    await f.knowledge.save(
      { ...first.entity, status: "FORGOTTEN", statement: "Oublié", version: 2 },
      { commandId: randomUUID(), deviceId: f.f.deviceId },
    );
    await f.proposal();
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    expect((await f.knowledge.list())[0]!.entity.status).toBe("FORGOTTEN");
  } finally {
    f.db.db.close();
  }
});

it("does not retroactively capture old discussions, and disabling then enabling does not backfill them", async () => {
  const f = await fixture();
  try {
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    await setAutomaticMemory(f.db, f.scope, false, activation);
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    await setAutomaticMemory(f.db, f.scope, true, now);
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    expect(await f.knowledge.list()).toEqual([]);
  } finally {
    f.db.db.close();
  }
});

it("adopts the canonical manual first writer for the same source, but refuses a different source", async () => {
  const f = await fixture();
  try {
    await readAutomaticMemory(f.db, f.scope, activation);
    await captureAutomaticMemories(f.db, f.scope, f.ctx);
    const local = (await f.knowledge.list())[0]!.entity;
    const { captureMode: _mode, ...manual } = local;
    void _mode;
    const remote = {
      ...manual,
      createdAt: now,
      updatedAt: now,
      version: 2,
      statement: "Pratique corrigée manuellement sur un autre appareil.",
    };
    await expect(
      applyKnowledgeRecord(
        f.db,
        f.scope,
        { ...remote, sourceMessageId: randomUUID() },
        1,
      ),
    ).rejects.toThrow("IDENTITY_INVALID");
    await applyKnowledgeRecord(f.db, f.scope, remote, 1);
    const adopted = (await f.knowledge.list())[0]!;
    expect(adopted.entity).toEqual(remote);
    expect(adopted.syncState).toBe("SYNCED");
  } finally {
    f.db.db.close();
  }
});

it("materializes the same proposal identically on two devices with different processing times", async () => {
  const f = await fixture(),
    other = new MercalysTestDatabase();
  try {
    await runLocalMigrations(other);
    await applyCopilotRecord(
      other,
      f.scope,
      "copilot_conversation",
      f.f.conversation,
    );
    const messages = await f.db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM copilot_messages WHERE store_id=? AND owner_id=?",
      f.scope.storeId,
      f.scope.ownerId,
    );
    for (const row of messages)
      await applyCopilotRecord(
        other,
        f.scope,
        "copilot_message",
        JSON.parse(row.payload_json),
      );
    for (const db of [f.db, other])
      await readAutomaticMemory(db, f.scope, activation);
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(1);
    expect(
      await captureAutomaticMemories(other, f.scope, {
        ...f.ctx,
        now: "2026-10-16T12:00:00.000Z",
      }),
    ).toBe(1);
    expect(
      (await new CopilotKnowledgeRepository(other, f.scope).list())[0]!.entity,
    ).toEqual((await f.knowledge.list())[0]!.entity);
  } finally {
    f.db.db.close();
    other.db.close();
  }
});

it("does not write across accounts or after authorization is revoked", async () => {
  const f = await fixture();
  try {
    await readAutomaticMemory(f.db, f.scope, activation);
    expect(
      await captureAutomaticMemories(
        f.db,
        { ...f.scope, ownerId: randomUUID() },
        f.ctx,
      ),
    ).toBe(0);
    expect(
      await captureAutomaticMemories(f.db, f.scope, {
        ...f.ctx,
        canCapture: () => false,
      }),
    ).toBe(0);
    expect(await f.knowledge.list()).toEqual([]);
  } finally {
    f.db.db.close();
  }
});

it("rechecks a corrected source inside the transaction rather than saving the obsolete proposal", async () => {
  const f = await fixture();
  try {
    await readAutomaticMemory(f.db, f.scope, activation);
    await f.repo.append(
      {
        ...f.source,
        id: randomUUID(),
        createdAt: now,
        text: "Correction : je prépare les TG le jeudi.",
        supersedesMessageId: f.source.id,
      },
      { commandId: randomUUID(), deviceId: f.f.deviceId },
    );
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
    expect(await f.knowledge.list()).toEqual([]);
  } finally {
    f.db.db.close();
  }
});

it.each(["correction", "disabled"] as const)(
  "refuses a proposal if %s arrives between its first read and its local transaction",
  async (mode) => {
    const f = await fixture();
    try {
      await readAutomaticMemory(f.db, f.scope, activation);
      const transact = f.db.withExclusiveTransactionAsync.bind(f.db);
      let inject = true;
      const spy = vi
        .spyOn(f.db, "withExclusiveTransactionAsync")
        .mockImplementation(async (task) => {
          if (inject) {
            inject = false;
            if (mode === "disabled")
              await setAutomaticMemory(f.db, f.scope, false, now);
            else
              await applyCopilotRecord(f.db, f.scope, "copilot_message", {
                ...f.source,
                id: randomUUID(),
                createdAt: now,
                text: "Correction : le jeudi.",
                supersedesMessageId: f.source.id,
              });
          }
          return transact(task);
        });
      expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(0);
      expect(await f.knowledge.list()).toEqual([]);
      spy.mockRestore();
    } finally {
      f.db.db.close();
    }
  },
);

it("rolls back memory and Outbox together if authority disappears during the write, then retries once", async () => {
  const f = await fixture();
  try {
    await readAutomaticMemory(f.db, f.scope, activation);
    let allowed = true;
    const run = f.db.runAsync.bind(f.db);
    const spy = vi
      .spyOn(f.db, "runAsync")
      .mockImplementation(async (sql, ...args) => {
        const result = await run(sql, ...args);
        if (sql.includes("INSERT INTO copilot_knowledge")) allowed = false;
        return result;
      });
    expect(
      await captureAutomaticMemories(f.db, f.scope, {
        ...f.ctx,
        canCapture: () => allowed,
      }),
    ).toBe(0);
    expect(await f.knowledge.list()).toEqual([]);
    expect(
      (await f.db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='copilot_knowledge'",
      ))!.n,
    ).toBe(0);
    spy.mockRestore();
    expect(await captureAutomaticMemories(f.db, f.scope, f.ctx)).toBe(1);
  } finally {
    f.db.db.close();
  }
});
