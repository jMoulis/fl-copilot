import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  SheetJsSpreadsheetParser,
  parseMercalysSales,
  parseMercalysWaste,
} from "../packages/import-core/src/index";
import type { MercalysImportValidationSummary } from "../apps/mobile/src/documents/mercalys-import-validation";
import type { OutboxDatabase } from "../apps/mobile/src/sync/outbox-repository";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
export class MercalysTestDatabase {
  constructor(readonly db = new DatabaseSync(":memory:")) {}
  async execAsync(sql: string) {
    this.db.exec(sql);
  }
  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async runAsync(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
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
export const mercalysTimestamp = "2026-10-14T10:00:00.000Z";
export async function mercalysLocalFixture(
  db: MercalysTestDatabase,
  storeId: string,
  productId: string,
) {
  await runLocalMigrations(db);
  await db.runAsync(
    "INSERT INTO app_metadata(key,value,updated_at) VALUES('device_id',?,?)",
    randomUUID(),
    mercalysTimestamp,
  );
  await db.runAsync(
    "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,'Tomate','VEGETABLE','BULK','KG','ACTIVE',1,?,?,'SYNCED',1,0)",
    productId,
    storeId,
    mercalysTimestamp,
    mercalysTimestamp,
  );
}
export function mercalysWorkbook(
  storeId: string,
  productId: string,
  sourceType: "MERCALYS_SALES" | "MERCALYS_WASTE" = "MERCALYS_SALES",
  date = "2026-10-07",
  sales = 12.4,
  includeReview = true,
) {
  const fr = date.split("-").reverse().join("/");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        `Statistique : Entrées / Sorties: Niveau de détail: Par Article, Détail Période: non détaillée, Flux: ${sourceType === "MERCALYS_SALES" ? "Vente Nette" : "Casse"}, Type valorisation: PA`,
      ],
      [`Sélection de données : Du ${fr} Au ${fr}`],
      [
        "ITM8 Prio",
        "EAN Prio",
        "Libellé",
        "Date",
        "Quantité",
        "Valeur Prix Achat",
        "Valeur RCE",
        "Valeur Prix Vente",
        "Valeur TVA",
        "Val Marge",
        "Marge",
      ],
      ["00000001", null, "TOMATE VRAC", fr, 2.5, 7.1, 0, sales, 0.6, 4.7, 37.9],
      ...(includeReview
        ? [
            [
              "00000002",
              null,
              "PRODUIT À CONFIRMER",
              fr,
              1,
              null,
              0,
              5,
              null,
              null,
              null,
            ],
          ]
        : []),
    ]),
    "Rapport",
  );
  const bytes = new Uint8Array(
    XLSX.write(book, { type: "array", bookType: "xlsx" }),
  );
  const workbook = new SheetJsSpreadsheetParser().parse(bytes);
  const parsed =
    sourceType === "MERCALYS_SALES"
      ? parseMercalysSales(workbook)
      : parseMercalysWaste(workbook);
  const summary: MercalysImportValidationSummary = {
    ...parsed,
    detectedLineCount: parsed.records.length,
    readyCount: 1,
    productReviewCount: parsed.records.length - 1,
    errorCount: 0,
    issueCodes: [],
    lines: parsed.records.map((record, index) => ({
      record,
      match: {
        state: index === 0 ? "AUTO_MATCH" : "NO_MATCH",
        matchedProductId: index === 0 ? productId : null,
        candidates: [],
        engineVersion: "product-matcher-v1",
        method: index === 0 ? "EXACT_IDENTIFIER" : null,
        conflict: null,
      },
    })),
  };
  return {
    bytes,
    input: {
      storeId,
      filename: `${date}.xlsx`,
      localFileUri: `file:///retained/${date}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: bytes.length,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      summary,
    },
  };
}
