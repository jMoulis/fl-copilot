import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { runLocalMigrations } from "../db/migrations";
import { SourceDocumentRepository } from "../documents/source-document-repository";
import { captureCommercialPdf } from "../documents/commercial-pdf-capture";
import { CopilotConversationRepository } from "../copilot/conversation-repository";
import { CopilotLocalChatController } from "../copilot/local-chat-controller";
import {
  CommercialStrategyConversation,
  strategyWeek,
} from "./strategy-conversation";
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});
async function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const sqlite = new ReceiptTestDatabase(db);
  await runLocalMigrations(sqlite);
  const scope = {
    storeId: randomUUID(),
    ownerId: randomUUID(),
    deviceId: randomUUID(),
  };
  const sourceId = randomUUID();
  await captureCommercialPdf(
    {
      uri: "file:///test.pdf",
      originalFilename: "pense-bete.pdf",
      storeId: scope.storeId,
      documentId: sourceId,
      fileId: randomUUID(),
      capturedAt: "2026-11-01T10:00:00Z",
    },
    new SourceDocumentRepository(sqlite),
    {
      persist: async () => ({
        localUri: "file:///retained/test.pdf",
        sizeBytes: 42,
        checksum: `sha256:${"a".repeat(64)}`,
      }),
      remove: async () => {},
    },
  );
  const repo = new CopilotConversationRepository(sqlite, scope);
  const controller = new CopilotLocalChatController(repo, scope, randomUUID);
  return { db, sqlite, scope, sourceId, repo, controller };
}
it("defaults to next ISO week across the year and preserves an explicit prior/future Monday", () => {
  expect(
    strategyWeek(undefined, new Date("2026-12-31T10:00:00Z")),
  ).toMatchObject({ start: "2027-01-04", number: 1, year: 2027 });
  expect(strategyWeek("2026-10-19")).toMatchObject({
    start: "2026-10-19",
    number: 43,
  });
});
it("prepares one offline editable discussion with the exact PDF without extraction or business writes; reopening preserves edits", async () => {
  const f = await fixture();
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(Error("NETWORK_DISABLED"));
  const strategy = new CommercialStrategyConversation(
    f.controller,
    f.sourceId,
    "2026-11-02",
  );
  const ids = await Promise.all([strategy.open(), strategy.open()]);
  expect(ids[0]).toBe(ids[1]);
  const opened = await f.controller.open(ids[0]!);
  expect(opened.draft).toMatchObject({
    text: expect.stringContaining("02/11/2026"),
    attachments: [
      {
        sourceDocumentId: f.sourceId,
        filename: "pense-bete.pdf",
        mediaType: "application/pdf",
      },
    ],
  });
  expect(opened.draft?.text).toContain("TG à thème");
  expect(opened.messages).toEqual([]);
  await f.controller.editText(ids[0]!, "Ma demande ajustée");
  await strategy.open();
  expect((await f.controller.open(ids[0]!)).draft?.text).toBe(
    "Ma demande ajustée",
  );
  expect(await f.repo.list()).toHaveLength(1);
  expect(network).not.toHaveBeenCalled();
  const commands = await f.sqlite.getAllAsync<{ entity_type: string }>(
    "SELECT entity_type FROM sync_outbox",
  );
  expect(commands.every((c) => c.entity_type === "copilot_conversation")).toBe(
    true,
  );
});
it("refuses a foreign PDF and retries a failed attachment without duplicating the conversation", async () => {
  const f = await fixture();
  const attach = vi
    .spyOn(f.controller, "attachPdf")
    .mockRejectedValueOnce(Error("TEMPORARY"));
  const strategy = new CommercialStrategyConversation(
    f.controller,
    f.sourceId,
    "2026-11-02",
  );
  await expect(strategy.open()).rejects.toThrow("TEMPORARY");
  attach.mockRestore();
  await strategy.open();
  expect(await f.repo.list()).toHaveLength(1);
  const otherScope = { ...f.scope, storeId: randomUUID() };
  const other = new CopilotLocalChatController(
    new CopilotConversationRepository(f.sqlite, otherScope),
    otherScope,
    randomUUID,
  );
  await expect(
    new CommercialStrategyConversation(other, f.sourceId, "2026-11-02").open(),
  ).rejects.toThrow("COPILOT_ATTACHMENT_SOURCE_UNAVAILABLE");
});
