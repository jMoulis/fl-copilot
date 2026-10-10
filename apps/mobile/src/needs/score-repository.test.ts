import { applyPullPage } from "../sync/apply-pull-page";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { substitutionScoreHistorySchema } from "@fl-copilot/domain";
import {
  conservativeSubstitutionScorePolicy,
  calculateConservativeSubstitutionScore,
  buildDailySubstitutionEvidence,
} from "@fl-copilot/substitution-core";
import { evidenceFixture } from "../../../../scripts/test-evidence-fixtures";
import {
  applySubstitutionScoreHistory,
  SubstitutionScoreRepository,
} from "./score-repository";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
class Adapter implements OutboxDatabase {
  constructor(readonly db: DatabaseSync) {}
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN");
    try {
      await task(this);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
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
it("keeps immutable score proof offline across restart, store guards and transactional rollback without Outbox", async () => {
  const f = await evidenceFixture(),
    e = await buildDailySubstitutionEvidence(f.input),
    c = calculateConservativeSubstitutionScore({
      relation: f.substitution,
      evidence: [e],
    });
  const audit = substitutionScoreHistorySchema.parse({
    id: randomUUID(),
    storeId: f.need.storeId,
    substitutionId: f.substitution.id,
    sourceProductId: f.product.id,
    substituteProductId: f.substitute.id,
    needUnitId: f.need.id,
    version: 1,
    relationshipVersion: 2,
    inputRevision: "a".repeat(64),
    previous: {
      observedSubstitution: null,
      relationshipScore: null,
      confidence: null,
      evidenceCount: 0,
      lastEvidenceAt: null,
    },
    next: c.metrics,
    reason: "INITIAL",
    policy: conservativeSubstitutionScorePolicy,
    compatibility: { need: 0.8, usage: 0.7, price: null, packaging: null },
    createdAt: f.input.now,
    evidence: c.decisions.map((d) => ({
      ...d,
      eventId: e.eventId,
      interpretation: e.interpretation,
      quality: e.dataQuality,
      strength: e.evidenceStrength,
      eventEndedAt: e.eventEndedAt,
      actualSalesValue: e.actualSalesValue,
      expectedSalesValue: e.expectedSalesValue,
      observedVariationPct: e.observedVariationPct,
    })),
  });
  const dir = mkdtempSync(join(tmpdir(), "fl-score_")),
    path = join(dir, "local.db");
  let db = new DatabaseSync(path);
  try {
    let tx = new Adapter(db);
    await runLocalMigrations(tx);
    await applySubstitutionScoreHistory(tx, audit.storeId, audit);
    await applySubstitutionScoreHistory(tx, audit.storeId, audit);
    db.close();
    db = new DatabaseSync(path);
    tx = new Adapter(db);
    expect(
      await new SubstitutionScoreRepository(tx).list(
        audit.storeId,
        audit.substitutionId,
      ),
    ).toEqual([audit]);
    expect(
      await new SubstitutionScoreRepository(tx).list(
        randomUUID(),
        audit.substitutionId,
      ),
    ).toEqual([]);
    await expect(
      applySubstitutionScoreHistory(tx, randomUUID(), audit),
    ).rejects.toThrow("STORE_INVALID");
    await expect(
      applySubstitutionScoreHistory(tx, audit.storeId, {
        ...audit,
        next: { ...audit.next, confidence: 0.4 },
      }),
    ).rejects.toThrow("IMMUTABLE");
    db.exec("BEGIN");
    await applySubstitutionScoreHistory(tx, audit.storeId, {
      ...audit,
      id: randomUUID(),
      relationshipVersion: 3,
    });
    db.exec("ROLLBACK");
    expect(
      await new SubstitutionScoreRepository(tx).list(
        audit.storeId,
        audit.substitutionId,
      ),
    ).toEqual([audit]);

    const change = (entity: typeof audit) => ({
      sequence: "1",
      entityType: "substitution_score_history",
      entityId: entity.id,
      entityVersion: 1,
      operation: "UPSERT" as const,
      entity,
      changedAt: audit.createdAt,
    });
    const page = {
      changes: [change(audit)],
      nextCursor: "score-cursor",
      hasMore: false,
      serverTime: audit.createdAt,
    };
    await applyPullPage(tx, audit.storeId, page);
    const another = { ...audit, id: randomUUID(), relationshipVersion: 3 };
    await expect(
      applyPullPage(tx, audit.storeId, {
        ...page,
        nextCursor: "bad-cursor",
        changes: [
          change(another),
          { ...change(audit), entityId: randomUUID() },
        ],
      }),
    ).rejects.toThrow("ENVELOPE_INVALID");
    expect(
      await new SubstitutionScoreRepository(tx).list(
        audit.storeId,
        audit.substitutionId,
      ),
    ).toEqual([audit]);
    expect(
      db
        .prepare("SELECT cursor FROM sync_inbox_state WHERE store_id=?")
        .get(audit.storeId)!.cursor,
    ).toBe("score-cursor");
    expect(db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()!.n).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
