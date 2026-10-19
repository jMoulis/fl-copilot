import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import {
  filterCatalogue,
  initialCatalogueView,
  CatalogueViewRepository,
  catalogueViewSchema,
} from "./catalogue-view";
import type { ProductListItem } from "./product-editor-hooks.types";
import type { OutboxDatabase } from "../sync/outbox-repository";
function item(
  label: string,
  patch: Partial<ProductListItem["record"]["entity"]> = {},
): ProductListItem {
  return {
    record: {
      dirty: false,
      syncState: "SYNCED",
      remoteVersion: 1,
      entity: {
        id: "11111111-1111-4111-8111-111111111111",
        storeId: "22222222-2222-4222-8222-222222222222",
        label,
        category: "VEGETABLE",
        nature: "BULK",
        salesUnit: "KG",
        packaging: null,
        familyId: null,
        subfamilyId: null,
        status: "ACTIVE",
        version: 1,
        createdAt: "2026-10-19T12:00:00.000Z",
        updatedAt: "2026-10-19T12:00:00.000Z",
        deletedAt: null,
        ...patch,
      },
    },
  };
}
it("searches accents, approved aliases and literal leading-zero codes and composes filters", () => {
  const courge = {
    ...item("Courge côtelée"),
    searchTerms: ["BUTTERNUT", "00001234"],
  };
  const poire = item("Poire", {
    category: "FRUIT",
    nature: "UNKNOWN",
    salesUnit: "UNKNOWN",
  });
  poire.record.dirty = true;
  poire.conflictId = "conflict";
  const all = [courge, poire];
  for (const query of ["cotelee", "butternut", "00001234"])
    expect(filterCatalogue(all, { ...initialCatalogueView, query })).toEqual([
      courge,
    ]);
  expect(
    filterCatalogue(all, {
      ...initialCatalogueView,
      query: "courge",
      category: "FRUIT",
    }),
  ).toEqual([]);
  for (const state of ["INCOMPLETE", "PENDING", "CONFLICT"] as const)
    expect(filterCatalogue(all, { ...initialCatalogueView, state })).toEqual([
      poire,
    ]);
  expect(
    filterCatalogue(all, { ...initialCatalogueView, nature: "PACKAGED" }),
  ).toEqual([]);
});
it("retains every matching row in a large catalogue for native virtualization", () => {
  const rows = Array.from({ length: 5100 }, (_, i) =>
    item(`Pomme ${i}`, { category: "FRUIT" }),
  );
  expect(
    filterCatalogue(rows, {
      ...initialCatalogueView,
      query: "pomme",
      category: "FRUIT",
    }),
  ).toHaveLength(5100);
});
it("restores a private store/user search and offset after SQLite restart without touching business commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catalogue-view-")),
    file = join(dir, "local.db");
  let db = new DatabaseSync(file);
  const adapter = () =>
    ({
      getFirstAsync: async <T>(sql: string, ...p: (string | number | null)[]) =>
        (db.prepare(sql).get(...p) as T) ?? null,
      getAllAsync: async <T>(sql: string, ...p: (string | number | null)[]) =>
        db.prepare(sql).all(...p) as T[],
      runAsync: async (sql: string, ...p: (string | number | null)[]) =>
        db.prepare(sql).run(...p),
    }) as OutboxDatabase;
  const scope = {
    storeId: "11111111-1111-4111-8111-111111111111",
    ownerId: "22222222-2222-4222-8222-222222222222",
  };
  try {
    db.exec(
      "CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE sync_outbox(id TEXT PRIMARY KEY)",
    );
    const view = {
      ...initialCatalogueView,
      query: "00001234",
      nature: "PACKAGED" as const,
      state: "INCOMPLETE" as const,
      scroll: 1234,
    };
    await new CatalogueViewRepository(adapter(), scope).save(view);
    db.close();
    db = new DatabaseSync(file);
    expect(await new CatalogueViewRepository(adapter(), scope).read()).toEqual(
      view,
    );
    expect(
      await new CatalogueViewRepository(adapter(), {
        ...scope,
        ownerId: scope.storeId,
      }).read(),
    ).toBeNull();
    expect(
      await new CatalogueViewRepository(adapter(), {
        ...scope,
        storeId: scope.ownerId,
      }).read(),
    ).toBeNull();
    expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual({
      n: 0,
    });
    expect(() =>
      catalogueViewSchema.parse({ ...view, query: "a".repeat(201) }),
    ).toThrow();
    expect(() => catalogueViewSchema.parse({ ...view, scroll: -1 })).toThrow();
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
