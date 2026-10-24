import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { runLocalMigrations } from "../db/migrations";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotLocalChatController } from "./local-chat-controller";

const close: DatabaseSync[] = [];
afterEach(() => close.splice(0).forEach((db) => db.close()));
async function fixture() {
  const db = new DatabaseSync(":memory:");
  close.push(db);
  const a = new ReceiptTestDatabase(db),
    f = chatFixture(randomUUID);
  await runLocalMigrations(a);
  const repo = new CopilotConversationRepository(a, f);
  await repo.save(f.conversation, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
  });
  await repo.append(f.message, {
    commandId: randomUUID(),
    deviceId: f.deviceId,
    replyId: randomUUID(),
  });
  await repo.saveDraft(f.conversation.id, {
    text: "Brouillon privé",
    attachments: f.message.attachments,
    updatedAt: f.message.createdAt,
  });
  const controller = new CopilotLocalChatController(repo, f, randomUUID);
  const snapshot = () =>
    JSON.stringify(
      [
        "copilot_conversations",
        "copilot_messages",
        "copilot_drafts",
        "copilot_pending_turns",
        "sync_outbox",
      ].map((table) =>
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ),
    );
  return { db, a, f, repo, controller, snapshot };
}
function gate() {
  let release!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}
it("refuses an already cancelled conversation deletion without clearing drafts, pending turns or history", async () => {
  const s = await fixture(),
    before = s.snapshot(),
    cancel = new AbortController();
  cancel.abort();
  await expect(
    s.controller.removeConversation(s.f.conversation.id, cancel.signal),
  ).rejects.toThrow("COPILOT_DELETE_CANCELLED");
  expect(s.snapshot()).toBe(before);
});
it("rechecks cancellation when a deletion leaves the existing controller queue", async () => {
  const s = await fixture(),
    before = s.snapshot(),
    cancel = new AbortController(),
    entered = gate(),
    resume = gate();
  const original = s.repo.get.bind(s.repo);
  vi.spyOn(s.repo, "get").mockImplementationOnce(async (id) => {
    entered.release();
    await resume.promise;
    return original(id);
  });
  const reading = s.controller.open(s.f.conversation.id);
  await entered.promise;
  const deleting = s.controller.removeConversation(
    s.f.conversation.id,
    cancel.signal,
  );
  cancel.abort();
  resume.release();
  await reading;
  await expect(deleting).rejects.toThrow("COPILOT_DELETE_CANCELLED");
  expect(s.snapshot()).toBe(before);
});
it("rechecks cancellation after waiting for the existing SQLite write queue", async () => {
  const s = await fixture(),
    before = s.snapshot(),
    cancel = new AbortController(),
    entered = gate(),
    resume = gate();
  const transaction = s.a.withExclusiveTransactionAsync.bind(s.a);
  vi.spyOn(s.a, "withExclusiveTransactionAsync").mockImplementationOnce(
    async (work) => {
      entered.release();
      await resume.promise;
      return transaction(work);
    },
  );
  const deleting = s.controller.removeConversation(
    s.f.conversation.id,
    cancel.signal,
  );
  await entered.promise;
  cancel.abort();
  resume.release();
  await expect(deleting).rejects.toThrow("COPILOT_DELETE_CANCELLED");
  expect(s.snapshot()).toBe(before);
});
it("rolls back the aggregate and Outbox when the context closes during a deletion transaction", async () => {
  const s = await fixture(),
    before = s.snapshot(),
    cancel = new AbortController();
  s.a.afterRun = (sql) => {
    if (sql.includes("INSERT INTO sync_outbox")) cancel.abort();
  };
  await expect(
    s.controller.removeConversation(s.f.conversation.id, cancel.signal),
  ).rejects.toThrow("COPILOT_DELETE_CANCELLED");
  expect(cancel.signal.aborted).toBe(true);
  expect(s.snapshot()).toBe(before);
});
it("keeps a confirmed deletion local, atomic and idempotent without deleting immutable messages", async () => {
  const s = await fixture(),
    cancel = new AbortController();
  const count = () =>
    (
      s.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get() as {
        n: number;
      }
    ).n;
  const before = count();
  await s.controller.removeConversation(s.f.conversation.id, cancel.signal);
  expect(await s.repo.get(s.f.conversation.id)).toMatchObject({
    status: "ARCHIVED",
    deletedAt: expect.any(String),
    version: 2,
  });
  expect(count()).toBe(before + 1);
  expect(
    s.db.prepare("SELECT COUNT(*) AS n FROM copilot_messages").get(),
  ).toMatchObject({ n: 1 });
  expect(
    s.db.prepare("SELECT COUNT(*) AS n FROM copilot_drafts").get(),
  ).toMatchObject({ n: 0 });
  expect(
    s.db.prepare("SELECT COUNT(*) AS n FROM copilot_pending_turns").get(),
  ).toMatchObject({ n: 0 });
  await s.controller.removeConversation(s.f.conversation.id, cancel.signal);
  expect(count()).toBe(before + 1);
});
