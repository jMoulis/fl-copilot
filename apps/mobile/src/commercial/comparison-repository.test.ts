import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { commercialChoiceFixture } from "../../../../scripts/test-commercial-choice-fixtures";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { applyCommercialVisualReading } from "./visual-repository";
import { applyCommercialChoice } from "./offer-choice-repository";
import { applyCommercialPreparation } from "./week-preparation-repository";
import { readCommercialComparison } from "./comparison-repository";
class Adapter implements OutboxDatabase {
  constructor(readonly db: DatabaseSync) {}
  async execAsync(s: string) {
    this.db.exec(s);
  }
  async runAsync(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).run(...p);
  }
  async getFirstAsync<T>(s: string, ...p: Array<string | number | null>) {
    return (this.db.prepare(s).get(...p) as T) ?? null;
  }
  async getAllAsync<T>(s: string, ...p: Array<string | number | null>) {
    return this.db.prepare(s).all(...p) as T[];
  }
}
describe("source comparison preserves operational decisions", () => {
  it("links changed source occurrences to retained choices/TGs without writing source, decision or plan data", async () => {
    const db = new DatabaseSync(":memory:"),
      tx = new Adapter(db);
    try {
      await runLocalMigrations(tx);
      const f = await commercialChoiceFixture(),
        g = await commercialChoiceFixture({ storeId: f.storeId });
      for (const reading of [f.reading, g.reading])
        reading.reading!.operations[0]!.items[0]!.fields.push({
          name: "productLabel",
          rawValue: "RAISIN BLANC VRAC",
          confidence: 1,
          evidence: [
            {
              pageNumber: 1,
              quote: "RAISIN BLANC VRAC",
              region: null,
              verification: "TEXT_SUPPORTED",
            },
          ],
          validationStatus: "TO_VALIDATE",
        });
      g.reading.reading!.operations[0]!.items[0]!.fields.find(
        (field) => field.name === "sellingPrice",
      )!.rawValue = "2,50€";
      await applyCommercialVisualReading(tx, f.storeId, f.reading);
      await applyCommercialVisualReading(tx, f.storeId, g.reading);
      await applyCommercialChoice(tx, f.storeId, f.choice);
      await applyCommercialPreparation(tx, f.storeId, {
        id: randomUUID(),
        storeId: f.storeId,
        weekStart: "2026-10-05",
        weekEnd: "2026-10-11",
        status: "DRAFT",
        tgCapacity: 1,
        offerRefs: [{ choiceId: f.choice.id, choiceVersion: 1 }],
        placements: [
          {
            id: randomUUID(),
            label: "TG entrée",
            theme: "Raisin",
            offerIds: [f.choice.id],
            sourceIdea: null,
          },
        ],
        note: "",
        version: 1,
        createdAt: f.choice.createdAt,
        updatedAt: f.choice.updatedAt,
      });
      const snapshot = () =>
        JSON.stringify(
          [
            "commercial_visual_readings",
            "commercial_offer_choices",
            "commercial_week_preparations",
            "sync_outbox",
          ].map((name) => db.prepare(`SELECT * FROM ${name}`).all()),
        );
      const before = snapshot(),
        report = await readCommercialComparison(
          tx,
          f.storeId,
          f.sourceDocumentId,
          g.sourceDocumentId,
        );
      expect(report.comparison.differences[0]?.changedFields).toContain(
        "PRICE",
      );
      expect(report.impacts[0]?.choices[0]?.choice.entity.id).toBe(f.choice.id);
      expect(report.impacts[0]?.choices[0]?.plans).toHaveLength(1);
      expect(snapshot()).toBe(before);
      const foreign = await readCommercialComparison(
        tx,
        randomUUID(),
        f.sourceDocumentId,
        g.sourceDocumentId,
      );
      expect(foreign.comparison.differences).toEqual([]);
      expect(foreign.impacts).toEqual([]);
    } finally {
      db.close();
    }
  });
});
