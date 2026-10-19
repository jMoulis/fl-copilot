import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { copilotMessageSchema } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { applyProductMasterSnapshot } from "../products/apply-product-master";
import { applyCommercialChoice } from "../commercial/offer-choice-repository";
import { applyStoreLayout } from "../store/layout-repository";
import { applyCopilotRecord } from "./conversation-repository";
import { CopilotStoreLayoutScenarioReader } from "./store-layout-scenario-reader";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { layoutScenarioFixture } from "../../../../scripts/test-layout-scenario-fixtures";
import { nextLayout } from "../../../../scripts/test-store-layout-fixtures";
import { presentStoreLayoutScenario } from "../../../api/src/copilot/store-layout-scenario-tool";
import { buildStoreLayoutScenarioMessages } from "../../../api/src/copilot/store-layout-scenario-messages";

class Adapter implements OutboxDatabase {
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
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
async function setup(path = ":memory:") {
  const db = new DatabaseSync(path),
    a = new Adapter(db),
    chat = chatFixture(randomUUID),
    f = await layoutScenarioFixture(chat.storeId);
  await runLocalMigrations(a);
  const assistant = copilotMessageSchema.parse({
    ...chat.message,
    id: randomUUID(),
    role: "ASSISTANT",
    text: "Voici une proposition sur le plan de référence.",
    attachments: [],
    replyToMessageId: chat.message.id,
  });
  const preview = presentStoreLayoutScenario(chat.storeId, f.input, f.sources),
    message = buildStoreLayoutScenarioMessages(assistant, [preview])[0]!;
  await a.withExclusiveTransactionAsync(async (tx) => {
    await applyCopilotRecord(
      tx,
      chat,
      "copilot_conversation",
      chat.conversation,
    );
    await applyCopilotRecord(tx, chat, "copilot_message", {
      ...chat.message,
      attachments: [],
    });
    await applyCopilotRecord(tx, chat, "copilot_message", assistant);
    await applyCopilotRecord(tx, chat, "copilot_message", message);
    await applyStoreLayout(tx, chat.storeId, f.first);
    await applyStoreLayout(tx, chat.storeId, f.reference);
    await applyProductMasterSnapshot(tx, chat.storeId, {
      products: f.sources.products,
      productAliases: [],
      productIdentifiers: [],
    });
    await applyCommercialChoice(tx, chat.storeId, f.choice.choice);
  });
  const reader = new CopilotStoreLayoutScenarioReader(a, chat),
    counts = () => ({
      history: db
        .prepare("SELECT COUNT(*) n FROM store_layout_revisions")
        .get()!.n,
      outbox: db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
      results: db.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!
        .n,
    });
  return { db, a, f, chat, assistant, preview, message, reader, counts };
}
it("reads the immutable schematic offline after restart without creating any business history, result or Outbox command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-layout-scenario-")),
    path = join(dir, "local.db"),
    s = await setup(path);
  let reopened: DatabaseSync | undefined;
  try {
    const before = s.counts(),
      value = await s.reader.open(s.message);
    expect(value.freshness).toBe("CURRENT");
    expect(value.layout).toEqual(s.f.reference);
    expect(value.scenario).toEqual(s.preview.scenario);
    expect(s.counts()).toEqual(before);
    s.db.close();
    reopened = new DatabaseSync(path);
    const reader = new CopilotStoreLayoutScenarioReader(
      new Adapter(reopened),
      s.chat,
    );
    expect(await reader.open(s.message)).toEqual(value);
    expect(
      reopened.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n,
    ).toBe(0);
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
it("ignores an unadopted draft, flags a new reference and always keeps the historical furniture and product labels", async () => {
  const s = await setup();
  try {
    const draft = nextLayout(s.f.reference);
    draft.content.furniture[0]!.label = "Nouveau placement non adopté";
    await applyStoreLayout(s.a, s.chat.storeId, draft);
    expect((await s.reader.open(s.message)).freshness).toBe("CURRENT");
    const id = randomUUID(),
      reference = nextLayout(draft, {
        action: "ADOPT_REFERENCE",
        revisionId: id,
        referenceRevisionId: id,
      });
    await applyStoreLayout(s.a, s.chat.storeId, reference);
    const before = s.counts(),
      result = await s.reader.open(s.message);
    expect(result.freshness).toBe("REVIEW_REQUIRED");
    expect(result.layout).toEqual(s.f.reference);
    expect(result.scenario).toEqual(s.preview.scenario);
    expect(JSON.stringify(result.layout)).not.toContain("Nouveau placement");
    expect(s.counts()).toEqual(before);
  } finally {
    s.db.close();
  }
});
it.each(["PRODUCT_VERSION", "OFFER_WITHDRAWN", "OFFER_DATES", "SYNC_CONFLICT"])(
  "flags source changes without rewriting the proposal: %s",
  async (mode) => {
    const s = await setup();
    try {
      if (mode === "PRODUCT_VERSION")
        await applyProductMasterSnapshot(s.a, s.chat.storeId, {
          products: [
            {
              ...s.f.product,
              version: s.f.product.version + 1,
              label: "Banane modifiée",
            },
          ],
          productAliases: [],
          productIdentifiers: [],
        });
      if (mode.startsWith("OFFER"))
        await applyCommercialChoice(s.a, s.chat.storeId, {
          ...s.f.choice.choice,
          version: s.f.choice.choice.version + 1,
          ...(mode === "OFFER_WITHDRAWN"
            ? { status: "WITHDRAWN" }
            : { saleEnd: "2026-10-08" }),
        });
      if (mode === "SYNC_CONFLICT")
        s.db
          .prepare("UPDATE products SET sync_state='CONFLICT' WHERE id=?")
          .run(s.f.product.id);
      const result = await s.reader.open(s.message);
      expect(result.freshness).toBe("REVIEW_REQUIRED");
      expect(result.scenario).toEqual(s.preview.scenario);
      expect(result.layout).toEqual(s.f.reference);
    } finally {
      s.db.close();
    }
  },
);
it.each(["PLAN_HISTORY", "PRODUCT", "OFFER", "HEAD"])(
  "reports missing local cache without substituting current geometry or claiming source deletion: %s",
  async (mode) => {
    const s = await setup();
    try {
      if (mode === "PLAN_HISTORY")
        s.db
          .prepare("DELETE FROM store_layout_revisions WHERE id=?")
          .run(s.f.reference.revisionId);
      if (mode === "PRODUCT")
        s.db.prepare("DELETE FROM products WHERE id=?").run(s.f.product.id);
      if (mode === "OFFER")
        s.db
          .prepare("DELETE FROM commercial_offer_choices WHERE id=?")
          .run(s.f.choice.choice.id);
      if (mode === "HEAD")
        s.db
          .prepare("DELETE FROM store_layouts WHERE id=?")
          .run(s.chat.storeId);
      const value = await s.reader.open(s.message);
      expect(value.freshness).toBe("UNVERIFIABLE");
      expect(value.layout).toEqual(
        mode === "PLAN_HISTORY" ? null : s.f.reference,
      );
      expect(value.scenario).toEqual(s.preview.scenario);
    } finally {
      s.db.close();
    }
  },
);
it("rejects foreign owners, altered cards and deleted conversations before exposing the private schematic", async () => {
  const s = await setup();
  try {
    await expect(
      new CopilotStoreLayoutScenarioReader(s.a, {
        ...s.chat,
        ownerId: randomUUID(),
      }).open(s.message),
    ).rejects.toThrow("SCOPE");
    const forged = {
      ...s.message,
      text: s.message.text.replace(
        "Proposition du rayon",
        "Proposition altérée",
      ),
    };
    await expect(s.reader.open(forged)).rejects.toThrow("UNAVAILABLE");
    s.db
      .prepare("UPDATE copilot_conversations SET payload_json=? WHERE id=?")
      .run(
        JSON.stringify({
          ...s.chat.conversation,
          status: "ARCHIVED",
          deletedAt: s.chat.conversation.updatedAt,
        }),
        s.chat.conversation.id,
      );
    await expect(s.reader.open(s.message)).rejects.toThrow("UNAVAILABLE");
    expect(s.counts()).toEqual({ history: 2, outbox: 0, results: 0 });
  } finally {
    s.db.close();
  }
});
