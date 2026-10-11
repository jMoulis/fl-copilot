import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { runLocalMigrations } from "../db/migrations";
import { CopilotConversationRepository } from "./conversation-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotToolRuntime } from "./tool-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
class Adapter implements OutboxDatabase {
  fail = false;
  productReads = 0;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(sql: string) {
    this.db.exec(sql);
  }
  async getFirstAsync<T>(sql: string, ...p: Array<string | number | null>) {
    if (sql.includes("FROM products")) this.productReads++;
    return (this.db.prepare(sql).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...p: Array<string | number | null>) {
    return this.db.prepare(sql).all(...p) as T[];
  }
  async runAsync(sql: string, ...p: Array<string | number | null>) {
    return this.db.prepare(sql).run(...p);
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.fail) throw Error("secret provider failure");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
async function fixture(path = ":memory:") {
  const db = new DatabaseSync(path),
    a = new Adapter(db),
    f = chatFixture(randomUUID);
  await runLocalMigrations(a);
  await new CopilotConversationRepository(a, f).save(f.conversation, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  const product = {
    id: randomUUID(),
    storeId: f.storeId,
    label: "BANANE VRAC",
    category: "FRUIT" as const,
    nature: "BULK" as const,
    salesUnit: "KG" as const,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: f.conversation.createdAt,
    updatedAt: f.conversation.createdAt,
    deletedAt: null,
  };
  await new ProductMasterRepository(a).upsertProduct(product, {
    commandId: randomUUID(),
    deviceId: randomUUID(),
  });
  await new ProductMasterRepository(a).upsertIdentifier(
    {
      id: randomUUID(),
      storeId: f.storeId,
      productId: product.id,
      type: "PLU",
      value: "00042",
      source: "USER",
      status: "VALIDATED",
      version: 1,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      deletedAt: null,
    },
    { commandId: randomUUID(), deviceId: randomUUID() },
  );
  return {
    db,
    a,
    f,
    product,
    scope: {
      storeId: f.storeId,
      ownerId: f.ownerId,
      conversationId: f.conversation.id,
      canReadStore: true,
    },
    request: {
      operationId: randomUUID(),
      tool: "product.inspect",
      schemaVersion: 1,
      input: { productId: product.id },
    },
  };
}
it("reads offline once, preserves the original result on restart/retry and creates no business command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-tools-")),
    path = join(dir, "data.db");
  const x = await fixture(path);
  let db = x.db;
  try {
    const before = db.prepare("SELECT count(*) AS n FROM sync_outbox").get();
    const first = await new CopilotToolRuntime(x.a).execute(x.request, x.scope);
    expect(first.snapshot?.product.entity.label).toBe("BANANE VRAC");
    expect(first.snapshot?.product.syncState).toBe("PENDING");
    expect(first.snapshot?.identifiers[0]?.entity.value).toBe("00042");
    expect(db.prepare("SELECT count(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    await new ProductMasterRepository(x.a).upsertProduct(
      { ...x.product, label: "NOUVEAU", version: 2 },
      { commandId: randomUUID(), deviceId: randomUUID() },
    );
    db.close();
    db = new DatabaseSync(path);
    const a = new Adapter(db),
      runtime = new CopilotToolRuntime(a);
    expect(await runtime.execute(x.request, x.scope)).toEqual(first);
    expect(a.productReads).toBe(0);
    expect(
      (
        await runtime.execute(
          { ...x.request, operationId: randomUUID() },
          x.scope,
        )
      ).snapshot?.product.entity.label,
    ).toBe("NOUVEAU");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects forged authority, revoked read access, foreign conversations and changed operation identities before cached disclosure", async () => {
  const x = await fixture(),
    runtime = new CopilotToolRuntime(x.a);
  try {
    await runtime.execute(x.request, x.scope);
    for (const request of [
      { ...x.request, ownerId: x.f.ownerId },
      { ...x.request, input: { ...x.request.input, storeId: x.f.storeId } },
      { ...x.request, tool: "product.update" },
    ])
      await expect(runtime.execute(request, x.scope)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    for (const scope of [
      { ...x.scope, canReadStore: false },
      { ...x.scope, ownerId: randomUUID() },
      { ...x.scope, storeId: randomUUID() },
      { ...x.scope, conversationId: randomUUID() },
    ])
      await expect(runtime.execute(x.request, scope)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(
      runtime.execute(
        { ...x.request, input: { productId: randomUUID() } },
        x.scope,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  } finally {
    x.db.close();
  }
});
it("hides foreign products, rolls back failed/cancelled reads and gives actionable redacted errors", async () => {
  const x = await fixture(),
    runtime = new CopilotToolRuntime(x.a);
  try {
    const foreign = { ...x.product, id: randomUUID(), storeId: randomUUID() };
    await new ProductMasterRepository(x.a).upsertProduct(foreign, {
      commandId: randomUUID(),
      deviceId: randomUUID(),
    });
    expect(
      (
        await runtime.execute(
          {
            ...x.request,
            operationId: randomUUID(),
            input: { productId: foreign.id },
          },
          x.scope,
        )
      ).snapshot,
    ).toBeNull();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      runtime.execute(x.request, x.scope, cancelled.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    x.a.fail = true;
    await expect(runtime.execute(x.request, x.scope)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "La lecture n’a pas pu être terminée. Vous pouvez réessayer.",
    });
    expect(
      x.db
        .prepare(
          "SELECT operation_id FROM copilot_tool_results WHERE operation_id = ?",
        )
        .get(x.request.operationId),
    ).toBeUndefined();
    x.a.fail = false;
    await runtime.execute(x.request, x.scope);
    expect(x.a.productReads).toBe(3);
  } finally {
    x.db.close();
  }
});
