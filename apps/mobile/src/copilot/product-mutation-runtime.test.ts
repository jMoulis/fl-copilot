import { buildProductDailyPerformance } from "@fl-copilot/analytics-core";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { productClassificationIntent } from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotProductMutationRuntime } from "./product-mutation-runtime";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
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
      if (this.fail) throw Error("secret database error");
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
    f = chatFixture(randomUUID),
    deviceId = randomUUID();
  await runLocalMigrations(a);
  const conversations = new CopilotConversationRepository(a, f);
  await conversations.save(f.conversation, {
    commandId: randomUUID(),
    deviceId,
  });
  await conversations.append(
    {
      ...f.message,
      text: "Précise ces produits en vrac et kg.",
      attachments: [],
    },
    { commandId: randomUUID(), deviceId },
  );
  const products = [0, 1].map((i) => ({
    id: randomUUID(),
    storeId: f.storeId,
    label: `Produit ${i}`,
    category: "UNKNOWN" as const,
    nature: "UNKNOWN" as const,
    salesUnit: "UNKNOWN" as const,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: f.conversation.createdAt,
    updatedAt: f.conversation.createdAt,
    deletedAt: null,
  }));
  for (const p of products)
    await new ProductMasterRepository(a).upsertProduct(p, {
      commandId: randomUUID(),
      deviceId,
    });
  // Simulate known canonical version-one records restored/acknowledged before the offline correction.
  db.exec(
    "UPDATE products SET sync_state='SYNCED',remote_version=1,dirty=0; UPDATE sync_outbox SET status='ACKNOWLEDGED'",
  );
  const request = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "product.classify",
    input: {
      changes: products.map((p) => ({
        productId: p.id,
        expectedVersion: 1,
        patch: { nature: "BULK", salesUnit: "KG" },
      })),
    },
  };
  const authority = (r: unknown = request) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canManageProducts: true,
    userMessageId: f.message.id,
    authorizedRequestJson: productClassificationIntent(r),
    decisionLevel: "ROUTINE" as const,
  });
  return {
    db,
    a,
    f,
    products,
    request,
    authority,
    runtime: new CopilotProductMutationRuntime(
      a,
      randomUUID,
      () => "2026-10-11T12:30:00.000Z",
    ),
  };
}
it("atomically corrects an offline batch through canonical product/Outbox services and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-product-tools-")),
    path = join(dir, "data.db"),
    x = await setup(path);
  let db = x.db;
  try {
    const daily = buildProductDailyPerformance({
      product: x.products[0]!,
      businessDate: "2026-10-10",
      salesObservations: [],
      wasteObservations: [],
      computedAt: x.f.conversation.createdAt,
    });
    await x.a.runAsync(
      "INSERT INTO product_daily_performance(id,store_id,product_id,business_date,payload_json,origin,formula_version,input_revision,computed_at) VALUES(?,?,?,?,?,'LOCAL',?,?,?)",
      randomUUID(),
      x.f.storeId,
      x.products[0]!.id,
      daily.date,
      JSON.stringify(daily),
      daily.formulaVersion,
      daily.inputRevision,
      daily.computedAt,
    );
    const result = await x.runtime.execute(x.request, x.authority());
    expect(result.changes).toHaveLength(2);
    expect(result.recomputationJobId).not.toBeNull();
    expect(
      result.changes.every(
        (c) =>
          c.before.nature === "UNKNOWN" &&
          c.after.nature === "BULK" &&
          c.after.version === 2,
      ),
    ).toBe(true);
    const commands = db
      .prepare(
        "SELECT command_id,expected_remote_version,payload_json FROM sync_outbox WHERE status='PENDING' ORDER BY local_sequence",
      )
      .all();
    expect(commands).toHaveLength(2);
    expect(commands.every((c) => c.expected_remote_version === 1)).toBe(true);
    expect(result.changes.map((c) => c.commandId)).toEqual(
      commands.map((c) => c.command_id),
    );
    db.close();
    db = new DatabaseSync(path);
    const runtime = new CopilotProductMutationRuntime(
      new Adapter(db),
      randomUUID,
    );
    expect(await runtime.execute(x.request, x.authority())).toEqual(result);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM local_jobs WHERE type='ANALYTICS_RECOMPUTE_PRODUCT_DATES'",
        )
        .get()?.n,
    ).toBe(1);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE status='PENDING'")
        .get()?.n,
    ).toBe(2);
    expect(
      (
        await new ProductMasterRepository(new Adapter(db)).getProduct(
          x.products[0]!.id,
        )
      )?.syncState,
    ).toBe("PENDING");
    const noChange = {
      ...x.request,
      operationId: randomUUID(),
      input: {
        changes: x.products.map((p) => ({
          productId: p.id,
          expectedVersion: 2,
          patch: { nature: "BULK" },
        })),
      },
    };
    const repeated = await runtime.execute(noChange, x.authority(noChange));
    expect(
      repeated.changes.every(
        (c) => c.commandId === null && c.after.version === 2,
      ),
    ).toBe(true);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE status='PENDING'")
        .get()?.n,
    ).toBe(2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rolls back every product, result and Outbox command when a later version or commit fails", async () => {
  const x = await setup();
  try {
    const stale = {
      ...x.request,
      input: {
        changes: [
          x.request.input.changes[0]!,
          { ...x.request.input.changes[1]!, expectedVersion: 9 },
        ],
      },
    };
    await expect(
      x.runtime.execute(stale, x.authority(stale)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(
      (await new ProductMasterRepository(x.a).getProduct(x.products[0]!.id))
        ?.entity.nature,
    ).toBe("UNKNOWN");
    expect(
      x.db
        .prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE status='PENDING'")
        .get()?.n,
    ).toBe(0);
    x.a.fail = true;
    await expect(
      x.runtime.execute(x.request, x.authority()),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "La correction n’a pas été enregistrée. Vous pouvez réessayer.",
    });
    x.a.fail = false;
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM copilot_tool_results").get()?.n,
    ).toBe(0);
    expect(
      (await new ProductMasterRepository(x.a).getProduct(x.products[0]!.id))
        ?.entity.version,
    ).toBe(1);
    await x.runtime.execute(x.request, x.authority());
    expect(
      x.db
        .prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE status='PENDING'")
        .get()?.n,
    ).toBe(2);
  } finally {
    x.db.close();
  }
});
it("binds authority to exact user intent and scope, rejects forged fields and rechecks rights before replay", async () => {
  const x = await setup();
  try {
    for (const ctx of [
      { ...x.authority(), canManageProducts: false },
      { ...x.authority(), ownerId: randomUUID() },
      { ...x.authority(), userMessageId: randomUUID() },
      { ...x.authority(), authorizedRequestJson: "{}" },
    ])
      await expect(x.runtime.execute(x.request, ctx)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(
      x.runtime.execute({ ...x.request, storeId: x.f.storeId }, x.authority()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const duplicate = {
      ...x.request,
      input: {
        changes: [x.request.input.changes[0]!, x.request.input.changes[0]!],
      },
    };
    await expect(
      x.runtime.execute(duplicate, x.authority()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await x.runtime.execute(x.request, x.authority());
    await expect(
      x.runtime.execute(x.request, {
        ...x.authority(),
        canManageProducts: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const changed = {
      ...x.request,
      input: {
        changes: [
          { ...x.request.input.changes[0]!, patch: { nature: "PACKAGED" } },
        ],
      },
    };
    await expect(
      x.runtime.execute(changed, x.authority(changed)),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    x.db.exec(
      "UPDATE copilot_messages SET payload_json=json_set(payload_json,'$.role','ASSISTANT')",
    );
    await expect(
      x.runtime.execute(x.request, x.authority()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    x.db.close();
  }
});
it("requires reviewed authority for known-value replacement, preserves sync conflicts and cancels atomically", async () => {
  const x = await setup();
  try {
    await x.runtime.execute(x.request, x.authority());
    const overwrite = {
      ...x.request,
      operationId: randomUUID(),
      input: {
        changes: [
          {
            productId: x.products[0]!.id,
            expectedVersion: 2,
            patch: { salesUnit: "PIECE" },
          },
        ],
        allowOverwriteConfirmed: true,
      },
    };
    await expect(
      x.runtime.execute(overwrite, x.authority(overwrite)),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    const approved = {
      ...x.authority(overwrite),
      decisionLevel: "REVIEWED" as const,
    };
    await x.runtime.execute(overwrite, approved);
    expect(
      x.db
        .prepare(
          "SELECT expected_remote_version FROM sync_outbox WHERE entity_id=? ORDER BY local_sequence DESC LIMIT 1",
        )
        .get(x.products[0]!.id)?.expected_remote_version,
    ).toBe(2);
    const conflict = {
      ...x.request,
      operationId: randomUUID(),
      input: {
        changes: [
          {
            productId: x.products[1]!.id,
            expectedVersion: 2,
            patch: { category: "FRUIT" },
          },
        ],
      },
    };
    x.db
      .prepare("UPDATE products SET sync_state='CONFLICT' WHERE id=?")
      .run(x.products[1]!.id);
    await expect(
      x.runtime.execute(conflict, x.authority(conflict)),
    ).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    x.db
      .prepare("UPDATE products SET sync_state='PENDING' WHERE id=?")
      .run(x.products[1]!.id);
    const c = new AbortController(),
      runtime = new CopilotProductMutationRuntime(x.a, () => {
        c.abort();
        return randomUUID();
      });
    const before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    await expect(
      runtime.execute(conflict, x.authority(conflict), c.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    expect(
      (await new ProductMasterRepository(x.a).getProduct(x.products[1]!.id))
        ?.entity.category,
    ).toBe("UNKNOWN");
  } finally {
    x.db.close();
  }
});
