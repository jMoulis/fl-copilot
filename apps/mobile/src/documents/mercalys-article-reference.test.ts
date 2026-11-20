import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, expect, it } from "vitest";
import type { SpreadsheetWorkbook } from "@fl-copilot/import-core";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { ProductMasterRepository } from "../products/product-master-repository";
import {
  planArticleReference,
  publishArticleReference,
} from "./mercalys-article-reference";
import {
  validateMercalysImport,
  rematchMercalysImport,
} from "./mercalys-import-validation";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";
import {
  readMercalysPublication,
  applyMercalysPublication,
} from "./mercalys-publication-sync";
import { PurchasePriceRepository } from "../products/purchase-price-repository";
const storeId = randomUUID(),
  deviceId = randomUUID(),
  at = "2026-11-20T12:00:00.000Z";
let db: DatabaseSync;
let adapter: OutboxDatabase & {
  execAsync(sql: string): Promise<void>;
  withExclusiveTransactionAsync(
    work: (tx: OutboxDatabase) => Promise<void>,
  ): Promise<void>;
};
let repo: ProductMasterRepository;
beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  adapter = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(
      sql: string,
      ...params: (string | number | null)[]
    ) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T>(
      sql: string,
      ...params: (string | number | null)[]
    ) => db.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: (string | number | null)[]) =>
      db.prepare(sql).run(...params),
    withExclusiveTransactionAsync: async (work) => {
      db.exec("BEGIN");
      try {
        await work(adapter);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  await runLocalMigrations(adapter);
  await adapter.runAsync(
    "INSERT INTO app_metadata(key,value,updated_at) VALUES('device_id',?,?)",
    deviceId,
    at,
  );
  repo = new ProductMasterRepository(adapter);
});
afterEach(() => db.close());
const rows = [
  [
    "0000087200198",
    "3250393062582",
    "BANANE RUBAN BIO MMP",
    "20 34 3400",
    1.55,
    "Oui",
    3.06,
    "5,5%",
  ],
  [
    "0000087430008",
    "8720165700066",
    "BANANE RUBAN BIO",
    "20 34 3400",
    1.4,
    "Oui",
    2.19,
    "5,5%",
  ],
] as (string | number)[][];
function workbook(data = rows, date = "20/11/2026"): SpreadsheetWorkbook {
  const values: (string | number)[][] = [
    ["Numéro point de vente : 9083"],
    [`Date d'application :${date}`],
    [
      "ITM",
      "EAN",
      "LIBELLE",
      "NOMENCLATURE",
      "PRIX ACHAT PAR UNITE",
      "ACTIF",
      "PV TTC",
      "Code TVA",
    ],
    ...data,
    [`Nombre de lignes : :${data.length}`],
  ];
  return {
    sheets: [
      {
        name: "Mercalys",
        rowCount: values.length,
        columnCount: 8,
        empty: false,
        rows: values.map((row) =>
          row.map((value) => ({
            kind:
              typeof value === "number"
                ? ("NUMBER" as const)
                : ("STRING" as const),
            value,
            formula: null,
            numberFormat: null,
            formattedValue: null,
          })),
        ),
      },
    ],
  };
}
async function catalog() {
  return {
    products: (await repo.listProducts(storeId)).map((r) => r.entity),
    identifiers: (await repo.listIdentifiersByStore(storeId)).map(
      (r) => r.entity,
    ),
    aliases: [],
  };
}
async function preview(data = rows, date = "20/11/2026") {
  const c = await catalog();
  return planArticleReference(
    validateMercalysImport(workbook(data, date), storeId, c),
    c,
    storeId,
    randomUUID,
    at,
  );
}
function input(plan: Awaited<ReturnType<typeof preview>>, checksum = "a") {
  return {
    storeId,
    filename: "referentiel.xlsx",
    localFileUri: "file:///private-test/referentiel.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 1234,
    checksum: `sha256:${checksum.repeat(64)}`,
    summary: plan.summary,
  };
}
const context = {
  deviceId,
  generateId: randomUUID,
  now: () => at,
  assertCurrentScope() {},
};
it("leaves both rows of a source EAN collision for review regardless of order", async () => {
  const duplicated = rows.map((r, i) =>
    r.map((v, k) => (i === 1 && k === 1 ? rows[0]![1]! : v)),
  );
  for (const data of [duplicated, [...duplicated].reverse()]) {
    const plan = await preview(data);
    expect(plan.blocked).toHaveLength(2);
    expect(plan.created).toBe(0);
    expect(plan.summary.readyCount).toBe(0);
    expect(
      plan.summary.lines.every((l) => l.match.matchedProductId === null),
    ).toBe(true);
  }
});
it("previews without writes, creates distinct references and prices, then recognises sales/casse codes without manual mapping", async () => {
  const before = db.prepare("SELECT total_changes() n").get();
  const plan = await preview();
  expect(plan).toMatchObject({
    created: 2,
    separated: 0,
    retained: 0,
    blocked: [],
    summary: { readyCount: 2, errorCount: 0 },
  });
  expect(db.prepare("SELECT total_changes() n").get()).toEqual(before);
  const result = await publishArticleReference(
    adapter,
    input(plan),
    plan,
    context,
  );
  expect(result).toMatchObject({
    publishedCount: 2,
    remainingCount: 0,
    analyticsJobId: null,
  });
  const c = await catalog();
  expect(c.products).toHaveLength(2);
  expect(
    c.products.every(
      (p) =>
        p.category === "UNKNOWN" &&
        p.salesUnit === "UNKNOWN" &&
        p.nature === "UNKNOWN",
    ),
  ).toBe(true);
  const mapped = rematchMercalysImport(
    {
      ...plan.summary,
      sourceType: "MERCALYS_SALES",
      lines: plan.summary.lines.map((l) => ({
        ...l,
        record: { ...l.record, itm8: l.record.itm8!.slice(5) },
      })),
    },
    storeId,
    c,
  );
  expect(mapped.readyCount).toBe(2);
  expect(new Set(mapped.lines.map((l) => l.match.matchedProductId)).size).toBe(
    2,
  );
  const publication = await readMercalysPublication(
    adapter,
    storeId,
    result.sourceDocumentId,
  );
  expect(
    publication!.prices.map((p) => [
      p.amount,
      p.sellingPriceTtc,
      p.vatRate,
      p.unit,
      p.priceStatus,
    ]),
  ).toEqual(
    expect.arrayContaining([
      ["1.55", "3.06", "5.5", "UNKNOWN", "TO_VERIFY"],
      ["1.4", "2.19", "5.5", "UNKNOWN", "TO_VERIFY"],
    ]),
  );
  await applyMercalysPublication(
    adapter,
    storeId,
    {
      id: result.sourceDocumentId,
      storeId,
      remoteVersion: 1,
      publication: publication!,
    },
    true,
  );
  expect(
    (await readMercalysPublication(adapter, storeId, result.sourceDocumentId))!
      .prices[0]!.sellingPriceTtc,
  ).toBeTruthy();
  const second = await preview(rows, "21/11/2026");
  expect(second.created).toBe(0);
  await publishArticleReference(adapter, input(second, "b"), second, context);
  expect((await catalog()).products).toHaveLength(2);
  expect(
    db.prepare("SELECT count(*) n FROM purchase_price_observations").get(),
  ).toEqual({ n: 4 });
  await expect(
    publishArticleReference(
      adapter,
      input(second, "b"),
      await preview(rows, "21/11/2026"),
      context,
    ),
  ).rejects.toThrow("MERCALYS_EXACT_DUPLICATE");
});

it("separates an old multi-ITM association without mutating the original product/history", async () => {
  const oldId = randomUUID();
  await repo.upsertProduct(
    {
      id: oldId,
      storeId,
      label: "Banane bio",
      category: "FRUIT",
      nature: "PACKAGED",
      salesUnit: "PIECE",
      packaging: { quantity: "5", unit: "PIECE" },
      status: "ACTIVE",
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    },
    { commandId: randomUUID(), deviceId },
  );
  for (const row of rows)
    for (const [type, value] of [
      ["ITM8", String(row[0])],
      ["EAN", String(row[1])],
    ] as const)
      await repo.upsertIdentifier(
        {
          id: randomUUID(),
          storeId,
          productId: oldId,
          type,
          value,
          source: "MERCALYS",
          status: "VALIDATED",
          version: 1,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
        },
        { commandId: randomUUID(), deviceId },
      );
  const old = await repo.getProduct(oldId);
  const plan = await preview();
  expect(plan.separated).toBe(2);
  await publishArticleReference(adapter, input(plan), plan, context);
  expect(await repo.getProduct(oldId)).toEqual(old);
  expect((await catalog()).products).toHaveLength(3);
  expect(
    new Set(
      (await catalog()).identifiers
        .filter((i) => i.type === "EAN")
        .map((i) => i.productId),
    ).size,
  ).toBe(2);
  const again = await preview(rows, "21/11/2026");
  expect(again.created).toBe(0);
});

it("keeps temporary off-base prices unusable even when source ACTIF says Oui", async () => {
  const data = rows.map((r, i) =>
    r.map((v, k) => (k === 4 && i === 0 ? 0.01 : k === 6 && i === 1 ? 999 : v)),
  );
  const plan = await preview(data);
  const result = await publishArticleReference(
    adapter,
    input(plan),
    plan,
    context,
  );
  const pub = (await readMercalysPublication(
    adapter,
    storeId,
    result.sourceDocumentId,
  ))!;
  expect(
    pub.prices.every(
      (p) =>
        p.referenceStatus === "TEMPORARILY_UNAVAILABLE" &&
        p.priceStatus === "TO_VERIFY",
    ),
  ).toBe(true);
  const price = pub.prices[0]!;
  await expect(
    new PurchasePriceRepository(adapter).confirm(
      storeId,
      price.productId,
      price.id,
      1,
      { now: at, generateId: randomUUID, assertCurrentScope() {} },
    ),
  ).rejects.toThrow();
  expect((await catalog()).products.every((p) => p.status === "ACTIVE")).toBe(
    true,
  );
});

it("rolls back catalogue, prices, original and all Outbox commands on interruption", async () => {
  const plan = await preview();
  let calls = 0;
  await expect(
    publishArticleReference(adapter, input(plan), plan, {
      ...context,
      assertCurrentScope() {
        if (++calls === 2) throw Error("scope changed");
      },
    }),
  ).rejects.toThrow("scope changed");
  for (const table of [
    "products",
    "product_identifiers",
    "purchase_price_observations",
    "source_documents",
    "source_records",
    "sync_outbox",
  ])
    expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({
      n: 0,
    });
});

it("rejects a changed preview and detects same-date PV-only corrections", async () => {
  const plan = await preview();
  await publishArticleReference(adapter, input(plan), plan, context);
  await expect(
    publishArticleReference(adapter, input(plan, "b"), plan, context),
  ).rejects.toThrow("ARTICLE_REFERENCE_PREVIEW_CHANGED");
  const changed = rows.map((r) => r.map((v, k) => (k === 6 ? 4 : v)));
  const correction = await preview(changed);
  const publisher = new MercalysImportPublicationRepository(
    adapter,
    randomUUID,
    () => at,
  );
  const comparison = await publisher.analyzeOverlap(
    storeId,
    correction.summary,
  );
  expect(comparison).toMatchObject({
    counts: { MODIFIED: 2 },
    safeToApply: true,
  });
  await expect(
    publishArticleReference(
      adapter,
      input(correction, "b"),
      correction,
      context,
    ),
  ).rejects.toThrow("MERCALYS_RECONCILIATION_REQUIRED");
  await publishArticleReference(
    adapter,
    {
      ...input(correction, "b"),
      reconciliationApproval: {
        fingerprint: comparison!.fingerprint,
        actorUserId: randomUUID(),
      },
    },
    correction,
    context,
  );
  expect(
    db
      .prepare(
        "SELECT selling_price_ttc FROM purchase_price_observations WHERE deleted_at IS NULL",
      )
      .all(),
  ).toEqual([{ selling_price_ttc: "4" }, { selling_price_ttc: "4" }]);
});
it("resolves contradictory old ITM/EAN owners from the unique official row after confirmation", async () => {
  const first = await preview();
  await publishArticleReference(adapter, input(first), first, context);
  const c = await catalog();
  const a = c.identifiers.find(
    (i) => i.type === "EAN" && i.value === rows[0]![1],
  )!;
  const secondId = c.products.find((p) => p.id !== a.productId)!.id;
  await adapter.runAsync(
    "UPDATE product_identifiers SET product_id=? WHERE id=?",
    secondId,
    a.id,
  );
  const correction = await preview(rows, "21/11/2026");
  expect(correction.blocked).toEqual([]);
  expect(correction.separated).toBeGreaterThan(0);
  await publishArticleReference(
    adapter,
    input(correction, "b"),
    correction,
    context,
  );
  expect((await preview(rows, "22/11/2026")).created).toBe(0);
});

it("never removes an omitted reference or lets an older export overwrite newer catalogue labels", async () => {
  const first = await preview();
  await publishArticleReference(adapter, input(first), first, context);
  const changed = [rows[0]!.map((v, i) => (i === 2 ? "NOUVEAU LIBELLE" : v))];
  const next = await preview(changed, "21/11/2026");
  await publishArticleReference(adapter, input(next, "b"), next, context);
  expect((await catalog()).products).toHaveLength(2);
  const before = await catalog();
  const old = await preview(rows, "19/11/2026");
  await expect(
    publishArticleReference(adapter, input(old, "c"), old, context),
  ).rejects.toThrow("ARTICLE_REFERENCE_OLDER_THAN_CURRENT");
  expect(await catalog()).toEqual(before);
});
it("adds valid references despite an inactive exception and resumes that same source without rewriting prior prices", async () => {
  const initial = await preview();
  await publishArticleReference(adapter, input(initial), initial, context);
  const p = (await repo.listProducts(storeId))[1]!;
  await repo.upsertProduct(
    { ...p.entity, status: "INACTIVE", version: p.entity.version + 1 },
    { commandId: randomUUID(), deviceId },
  );
  const next = await preview(rows, "21/11/2026");
  expect(next.blocked).toHaveLength(1);
  expect(next.summary.readyCount).toBe(1);
  const first = await publishArticleReference(
    adapter,
    input(next, "b"),
    next,
    context,
  );
  expect(first).toMatchObject({ publishedCount: 1, remainingCount: 1 });
  const source = (await readMercalysPublication(
    adapter,
    storeId,
    first.sourceDocumentId,
  ))!;
  const inactive = (await repo.getProduct(p.entity.id))!;
  await repo.upsertProduct(
    {
      ...inactive.entity,
      status: "ACTIVE",
      version: inactive.entity.version + 1,
    },
    { commandId: randomUUID(), deviceId },
  );
  const publisher = new MercalysImportPublicationRepository(
    adapter,
    randomUUID,
    () => at,
  );
  const c = await catalog();
  const pending = await publisher.continuation(
    storeId,
    input(next, "b").checksum,
    rematchMercalysImport(next.summary, storeId, c),
  );
  const rest = planArticleReference(
    pending!.summary,
    c,
    storeId,
    randomUUID,
    at,
  );
  const result = await publishArticleReference(
    adapter,
    { ...input(rest, "b") },
    rest,
    { ...context, sourceDocumentId: first.sourceDocumentId },
  );
  expect(result).toMatchObject({
    publishedCount: 1,
    remainingCount: 0,
    sourceDocumentId: first.sourceDocumentId,
  });
  const final = (await readMercalysPublication(
    adapter,
    storeId,
    first.sourceDocumentId,
  ))!;
  expect(final.prices).toHaveLength(2);
  expect(final.prices.find((p) => p.id === source.prices[0]!.id)).toEqual(
    source.prices[0],
  );
});
