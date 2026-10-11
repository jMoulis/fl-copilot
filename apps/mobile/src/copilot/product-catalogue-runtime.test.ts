import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import {
  productCatalogueIntent,
  productSaveResultSchema,
  productRetireResultSchema,
} from "@fl-copilot/domain";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  emptyProductDraft,
  productSnapshotToDraft,
} from "../products/product-editor-service";
import { ProductMasterRepository } from "../products/product-master-repository";
import { CopilotConversationRepository } from "./conversation-repository";
import { CopilotProductCatalogueRuntime } from "./product-catalogue-runtime";
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
      if (this.fail) throw Error("private SQLite detail");
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
  const repo = new CopilotConversationRepository(a, f);
  await repo.save(f.conversation, { commandId: randomUUID(), deviceId });
  await repo.append(
    { ...f.message, text: "Enregistre cette fiche produit.", attachments: [] },
    { commandId: randomUUID(), deviceId },
  );
  const create = {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "product.save",
    input: {
      mode: "CREATE",
      productId: null,
      expectedVersion: null,
      expectedChildren: { identifiers: [], aliases: [] },
      draft: {
        ...emptyProductDraft,
        label: "BANANE VRAC",
        nature: "BULK",
        salesUnit: "KG",
        identifiers: [{ type: "PLU", value: "00042" }],
        aliases: [{ alias: "banane" }],
      },
    },
  };
  const authority = (r: unknown) => ({
    storeId: f.storeId,
    ownerId: f.ownerId,
    conversationId: f.conversation.id,
    deviceId,
    canManageProducts: true,
    userMessageId: f.message.id,
    authorizedRequestJson: productCatalogueIntent(r),
    decisionLevel: "REVIEWED" as const,
  });
  return {
    db,
    a,
    f,
    create,
    authority,
    runtime: new CopilotProductCatalogueRuntime(
      a,
      randomUUID,
      () => "2026-10-11T13:00:00.000Z",
    ),
  };
}
function edit(
  after: ReturnType<typeof productSaveResultSchema.parse>["after"],
) {
  return {
    operationId: randomUUID(),
    schemaVersion: 1,
    tool: "product.save",
    input: {
      mode: "UPDATE",
      productId: after.product.entity.id,
      expectedVersion: after.product.entity.version,
      expectedChildren: {
        identifiers: after.identifiers.map((r) => ({
          id: r.entity.id,
          version: r.entity.version,
        })),
        aliases: after.aliases.map((r) => ({
          id: r.entity.id,
          version: r.entity.version,
        })),
      },
      draft: productSnapshotToDraft(after),
    },
  };
}
it("creates a complete aggregate atomically offline with stable IDs/leading-zero identifiers and replays once after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fl-catalogue-tools-")),
    path = join(dir, "local.db"),
    x = await setup(path);
  let db = x.db;
  try {
    const r = productSaveResultSchema.parse(
      await x.runtime.execute(x.create, x.authority(x.create)),
    );
    expect(r.before).toBeNull();
    expect(r.after.identifiers[0]?.entity.value).toBe("00042");
    expect(r.commandIds).toHaveLength(3);
    expect(r.after.product.syncState).toBe("PENDING");
    db.close();
    db = new DatabaseSync(path);
    const runtime = new CopilotProductCatalogueRuntime(
      new Adapter(db),
      randomUUID,
    );
    expect(await runtime.execute(x.create, x.authority(x.create))).toEqual(r);
    expect(db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_type LIKE 'product%'",
        )
        .get()?.n,
    ).toBe(3);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("updates packaging/children through the canonical editor, soft-deletes omitted aliases and chains pending versions correctly", async () => {
  const x = await setup();
  try {
    const r = productSaveResultSchema.parse(
        await x.runtime.execute(x.create, x.authority(x.create)),
      ),
      request = edit(r.after);
    request.input.draft.label = "BANANE CONDITIONNÉE";
    request.input.draft.nature = "PACKAGED";
    request.input.draft.salesUnit = "PACK";
    request.input.draft.packagingQuantity = "0,5";
    request.input.draft.packagingUnit = "KG";
    request.input.draft.aliases = [];
    const updated = productSaveResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(updated.after.product.entity.packaging?.quantity).toBe("0.5");
    expect(updated.after.product.entity.version).toBe(2);
    expect(updated.after.identifiers[0]?.entity.value).toBe("00042");
    expect(updated.after.aliases).toHaveLength(0);
    const commands = x.db
      .prepare(
        "SELECT command_type,expected_remote_version FROM sync_outbox WHERE command_id IN (?,?,?)",
      )
      .all(...updated.commandIds);
    expect(commands.every((c) => c.expected_remote_version === 1)).toBe(true);
    expect(
      commands.some((c) => c.command_type === "PRODUCT_ALIAS_DELETE"),
    ).toBe(true);
    expect(
      x.db
        .prepare("SELECT deleted_at FROM product_aliases WHERE id=?")
        .get(r.after.aliases[0]!.entity.id)?.deleted_at,
    ).not.toBeNull();
  } finally {
    x.db.close();
  }
});
it("rejects child revisions/foreign child IDs, identifier collisions and refused aliases before partial writes", async () => {
  const x = await setup();
  try {
    const r = productSaveResultSchema.parse(
        await x.runtime.execute(x.create, x.authority(x.create)),
      ),
      request = edit(r.after),
      alias = r.after.aliases[0]!.entity;
    await new ProductMasterRepository(x.a).upsertAlias(
      { ...alias, status: "REJECTED", version: 2 },
      {
        commandId: randomUUID(),
        deviceId: x.authority(request).deviceId,
        expectedRemoteVersion: 1,
      },
    );
    const count = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "CHILD_CONFLICT" });
    request.input.expectedChildren.aliases[0]!.version = 2;
    request.input.draft.aliases = [{ alias: "banane" }];
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "ALIAS_REFUSED" });
    request.input.draft.aliases = [{ id: randomUUID(), alias: "banane" }];
    await expect(
      x.runtime.execute(request, x.authority(request)),
    ).rejects.toMatchObject({ code: "CHILD_CONFLICT" });
    const duplicate = {
      ...x.create,
      operationId: randomUUID(),
      input: {
        ...x.create.input,
        draft: { ...x.create.input.draft, label: "Autre banane" },
      },
    };
    await expect(
      x.runtime.execute(duplicate, x.authority(duplicate)),
    ).rejects.toMatchObject({ code: "IDENTIFIER_CONFLICT" });
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      count,
    );
    expect(
      (
        await new ProductMasterRepository(x.a).getProduct(
          r.after.product.entity.id,
        )
      )?.entity.version,
    ).toBe(1);
    request.input.draft.aliases = [{ id: alias.id, alias: alias.alias }];
    const preserved = productSaveResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(preserved.after.aliases[0]?.entity.status).toBe("REJECTED");
  } finally {
    x.db.close();
  }
});
it("retires by canonical tombstone without physical deletion and protects foreign/unknown products, scope and reviewed authority", async () => {
  const x = await setup();
  try {
    const r = productSaveResultSchema.parse(
        await x.runtime.execute(x.create, x.authority(x.create)),
      ),
      request = {
        operationId: randomUUID(),
        schemaVersion: 1,
        tool: "product.retire",
        input: { productId: r.after.product.entity.id, expectedVersion: 1 },
      };
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        decisionLevel: "ROUTINE",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const retired = productRetireResultSchema.parse(
      await x.runtime.execute(request, x.authority(request)),
    );
    expect(retired.after.deletedAt).not.toBeNull();
    expect(retired.after.id).toBe(retired.before.id);
    expect(retired.after.version).toBe(2);
    expect(retired.commandIds).toHaveLength(1);
    expect(await x.runtime.execute(request, x.authority(request))).toEqual(
      retired,
    );
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(1);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM product_aliases").get()?.n,
    ).toBe(1);
    const foreignProduct = {
      ...r.after.product.entity,
      id: randomUUID(),
      storeId: randomUUID(),
    };
    await new ProductMasterRepository(x.a).upsertProduct(foreignProduct, {
      commandId: randomUUID(),
      deviceId: x.authority(request).deviceId,
    });
    const foreignRequest = {
      ...request,
      operationId: randomUUID(),
      input: {
        productId: foreignProduct.id,
        expectedVersion: foreignProduct.version,
      },
    };
    await expect(
      x.runtime.execute(foreignRequest, x.authority(foreignRequest)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    expect(
      (await new ProductMasterRepository(x.a).getProduct(foreignProduct.id))
        ?.entity.deletedAt,
    ).toBeNull();
    const missing = {
      ...request,
      operationId: randomUUID(),
      input: { ...request.input, productId: randomUUID() },
    };
    await expect(
      x.runtime.execute(missing, x.authority(missing)),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    await expect(
      x.runtime.execute(request, {
        ...x.authority(request),
        canManageProducts: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      x.runtime.execute(
        { ...x.create, storeId: x.f.storeId },
        x.authority(x.create),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    x.db.close();
  }
});
it("rolls back aggregate, commands and operation result on commit failure or in-flight cancellation", async () => {
  const x = await setup();
  try {
    const before = x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get();
    x.a.fail = true;
    await expect(
      x.runtime.execute(x.create, x.authority(x.create)),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "La correction n’a pas été enregistrée. Vous pouvez réessayer.",
    });
    x.a.fail = false;
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(0);
    expect(
      x.db.prepare("SELECT COUNT(*) AS n FROM copilot_tool_results").get()?.n,
    ).toBe(0);
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get()).toEqual(
      before,
    );
    const controller = new AbortController(),
      runtime = new CopilotProductCatalogueRuntime(x.a, () => {
        controller.abort();
        return randomUUID();
      });
    await expect(
      runtime.execute(x.create, x.authority(x.create), controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(0);
    await x.runtime.execute(x.create, x.authority(x.create));
    expect(x.db.prepare("SELECT COUNT(*) AS n FROM products").get()?.n).toBe(1);
  } finally {
    x.db.close();
  }
});
