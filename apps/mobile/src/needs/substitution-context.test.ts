import { DatabaseSync } from "node:sqlite";
import { it, expect } from "vitest";
import {
  readSubstitutionMarginContext,
  sourceMarginLabel,
} from "./substitution-context";
import type { OutboxDatabase } from "@/sync/outbox-repository";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE sales_observations(id TEXT,store_id TEXT,product_id TEXT,business_date TEXT,margin_value TEXT,margin_rate TEXT,source_document_id TEXT,source_record_id TEXT,validation_status TEXT,deleted_at TEXT)",
  );
  const adapter = {
    getAllAsync: async <T>(
      sql: string,
      ...params: Array<string | number | null>
    ) => db.prepare(sql).all(...params) as T[],
  } as OutboxDatabase;
  const insert = (
    id: string,
    store: string,
    product: string,
    date: string,
    margin: string | null,
    rate: string | null,
    status = "VALIDATED",
    deleted: string | null = null,
  ) =>
    db
      .prepare("INSERT INTO sales_observations VALUES(?,?,?,?,?,?,?,? ,?,?)")
      .run(
        id,
        store,
        product,
        date,
        margin,
        rate,
        "doc-" + id,
        "record-" + id,
        status,
        deleted,
      );
  return { db, adapter, insert };
}
it("uses published non-deleted same-store latest observations and retains source/date without changing facts", async () => {
  const f = fixture();
  try {
    f.insert("a", "s", "p", "2026-10-01", "2.40", "30");
    f.insert("b", "s", "p", "2026-10-02", "0", "0");
    f.insert("foreign", "other", "p", "2026-10-04", "999", "99");
    f.insert("unconfirmed", "s", "p", "2026-10-05", "999", "99", "TO_REVIEW");
    f.insert(
      "removed",
      "s",
      "p",
      "2026-10-06",
      "999",
      "99",
      "VALIDATED",
      "2026-10-06",
    );
    const r = await readSubstitutionMarginContext(f.adapter, "s", [
      "p",
      "p",
      "missing",
    ]);
    expect(r.p).toMatchObject({
      businessDate: "2026-10-02",
      marginValue: "0",
      marginRate: "0",
      sourceDocumentId: "doc-b",
      sourceRecordId: "record-b",
      observationCount: 1,
    });
    expect(r.missing).toBeUndefined();
    expect(sourceMarginLabel(r.p)).toContain("0,00 €");
    expect(sourceMarginLabel(r.p)).toContain("0 %");
    expect(
      f.db.prepare("SELECT COUNT(*) n FROM sales_observations").get()?.n,
    ).toBe(5);
  } finally {
    f.db.close();
  }
});
it("does not choose or sum competing observations and never calls missing margin zero", async () => {
  const f = fixture();
  try {
    f.insert("a", "s", "p", "2026-10-02", "3", "30");
    f.insert("b", "s", "p", "2026-10-02", "4", "40");
    f.insert("c", "s", "q", "2026-10-01", null, null);
    const r = await readSubstitutionMarginContext(f.adapter, "s", ["p", "q"]);
    expect(r.p).toMatchObject({
      observationCount: 2,
      marginValue: null,
      marginRate: null,
      sourceRecordId: null,
    });
    expect(sourceMarginLabel(r.p)).toContain("sans consolidation");
    expect(sourceMarginLabel(r.q)).toContain("indisponible");
    expect(sourceMarginLabel(undefined)).toContain("Aucune observation");
    expect(await readSubstitutionMarginContext(f.adapter, "s", [])).toEqual({});
  } finally {
    f.db.close();
  }
});
