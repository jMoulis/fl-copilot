import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { copilotMessageSchema } from "@fl-copilot/domain";
import { readConversationGenerationHistory } from "./generation-history";

function fixture() {
  const parent = copilotMessageSchema.parse({
    id: randomUUID(),
    storeId: randomUUID(),
    ownerId: randomUUID(),
    conversationId: randomUUID(),
    role: "USER",
    text: "Ma question corrigée",
    attachments: [],
    replyToMessageId: null,
    supersedesMessageId: null,
    version: 1,
    createdAt: "2026-10-16T12:00:00.000Z",
  });
  const old = {
    ...parent,
    id: randomUUID(),
    text: "Ancienne question",
    createdAt: "2026-10-16T11:00:00.000Z",
  };
  const answer = {
    ...old,
    id: randomUUID(),
    role: "ASSISTANT" as const,
    replyToMessageId: old.id,
    text: "Ancienne réponse",
  };
  const latest = {
    ...old,
    id: randomUUID(),
    text: "Précision conservée",
    createdAt: "2026-10-16T11:30:00.000Z",
  };
  const distinct = vi.fn(async () => [old.id]);
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn(async () =>
      [latest, answer, old].map((m) => ({ _id: m.id, ...m })),
    ),
  };
  const find = vi.fn(() => cursor);
  const db = { collection: vi.fn(() => ({ find, distinct })) } as unknown as Db;
  return { parent, old, answer, latest, distinct, find, db };
}

it("excludes corrected questions and their old answers, retaining other context", async () => {
  const f = fixture();
  const result = await readConversationGenerationHistory(f.db, f.parent);
  expect(result.messages.map((m) => m.id)).toEqual([f.latest.id]);
  expect(result.earlierMessagesOmitted).toBe(true);
  expect(f.distinct).toHaveBeenCalledWith(
    "supersedesMessageId",
    {
      storeId: f.parent.storeId,
      ownerId: f.parent.ownerId,
      conversationId: f.parent.conversationId,
      role: "USER",
      createdAt: { $lte: f.parent.createdAt },
      supersedesMessageId: { $in: [f.latest.id, f.old.id] },
    },
    { maxTimeMS: 2000 },
  );
});

it("honours the current correction before its database copy is visible", async () => {
  const f = fixture();
  f.distinct.mockResolvedValue([]);
  f.parent.supersedesMessageId = f.old.id;
  const result = await readConversationGenerationHistory(f.db, f.parent);
  expect(result.messages.map((m) => m.id)).toEqual([f.latest.id]);
});

it("retains whole uncorrected messages and reports complete coverage", async () => {
  const f = fixture();
  f.distinct.mockResolvedValue([]);
  const result = await readConversationGenerationHistory(f.db, f.parent);
  expect(result.messages.map((m) => m.text)).toEqual([
    f.old.text,
    f.answer.text,
    f.latest.text,
  ]);
  expect(result.earlierMessagesOmitted).toBe(false);
});
