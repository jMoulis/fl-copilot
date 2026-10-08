import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  CommercialReviewPage,
  CommercialReviewDecision,
} from "@fl-copilot/sync-contracts";
import { runLocalMigrations } from "../db/migrations";
import type { OutboxDatabase } from "../sync/outbox-repository";
import {
  CommercialReviewRepository,
  applyCommercialReviewEntity,
  reviewProgress,
} from "./review-repository";
import { applyPullPage } from "../sync/apply-pull-page";
import { applyBootstrap } from "../sync/apply-bootstrap";
import type { BootstrapResponse } from "@fl-copilot/sync-contracts";
const storeId = randomUUID(),
  sourceDocumentId = randomUUID(),
  pageId = randomUUID(),
  deviceId = randomUUID();
const page: CommercialReviewPage = {
  id: pageId,
  storeId,
  sourceDocumentId,
  checksum: "sha256:test",
  pageNumber: 1,
  pageCount: 1,
  originalFilename: "week.pdf",
  remoteVersion: 1,
  warnings: ["UNCERTAIN_DATE"],
  issues: [],
  blocks: [
    {
      kind: "OFFER",
      label: "POIRE",
      sourceBlockIndex: 4,
      validationStatus: "TO_VALIDATE",
      evidence: [{ pageNumber: 1, spanIndices: [0], quote: "POIRE 2,99 €/kg" }],
      fields: [
        {
          name: "sellingPrice",
          rawValue: "2,99 €/kg",
          confidence: 0.8,
          evidence: [{ pageNumber: 1, spanIndices: [0], quote: "2,99 €/kg" }],
          validationStatus: "TO_VALIDATE",
        },
      ],
    },
  ],
};
function decision(
  overrides: Partial<CommercialReviewDecision> = {},
): CommercialReviewDecision {
  return {
    id: randomUUID(),
    storeId,
    sourceDocumentId,
    pageId,
    checksum: page.checksum,
    sourceBlockIndex: 4,
    decision: "CONFIRMED_TRANSCRIPTION",
    corrections: [{ name: "sellingPrice", value: "3,49 €/kg" }],
    reviewedAt: new Date().toISOString(),
    ...overrides,
  };
}
class SqliteAdapter implements OutboxDatabase {
  failCommit = false;
  constructor(readonly db: DatabaseSync) {}
  async execAsync(sql: string) {
    this.db.exec(sql);
  }
  async runAsync(sql: string, ...params: Array<string | number | null>) {
    return this.db.prepare(sql).run(...params);
  }
  async getFirstAsync<T>(
    sql: string,
    ...params: Array<string | number | null>
  ) {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: Array<string | number | null>) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      if (this.failCommit) throw Error("Commit failed");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const connections: DatabaseSync[] = [],
  directories: string[] = [];
async function setup(path = ":memory:", fixture = page) {
  const db = new DatabaseSync(path);
  connections.push(db);
  const adapter = new SqliteAdapter(db);
  await runLocalMigrations(adapter);
  await applyCommercialReviewEntity(
    adapter,
    storeId,
    "commercial_review_page",
    fixture,
  );
  return { db, adapter, repo: new CommercialReviewRepository(adapter) };
}
afterEach(() => {
  for (const db of connections.splice(0)) {
    try {
      db.close();
    } catch {
      /* Already closed for restart. */
    }
  }
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
describe("local commercial extraction review", () => {
  it("retains source snapshots and atomic offline decisions across restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fl-review-"));
    directories.push(dir);
    const path = join(dir, "local.db");
    const first = await setup(path);
    const d = decision();
    await first.repo.review(d, deviceId, randomUUID());
    first.db.close();
    const second = await setup(path);
    expect(await second.repo.pages(storeId)).toEqual([page]);
    expect((await second.repo.decisions(storeId))[0]).toEqual({
      decision: d,
      state: "PENDING",
    });
    expect(
      second.db.prepare("SELECT command_type FROM sync_outbox").get(),
    ).toEqual({ command_type: "COMMERCIAL_TRANSCRIPTION_REVIEW" });
    expect(
      second.db
        .prepare("SELECT COUNT(*) AS count FROM sales_observations")
        .get(),
    ).toEqual({ count: 0 });
  });
  it("rolls back both decision and Outbox if the transaction fails", async () => {
    const { adapter, repo, db } = await setup();
    adapter.failCommit = true;
    await expect(
      repo.review(decision(), deviceId, randomUUID()),
    ).rejects.toThrow("Commit failed");
    expect(await repo.decisions(storeId)).toEqual([]);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get(),
    ).toEqual({ count: 0 });
  });
  it("refuses a changed checksum, another store and unknown correction fields", async () => {
    const { repo } = await setup();
    for (const d of [
      decision({ checksum: "wrong" }),
      decision({ storeId: randomUUID() }),
      decision({ corrections: [{ name: "purchasePrice", value: "1,00 €" }] }),
    ])
      await expect(repo.review(d, deviceId, randomUUID())).rejects.toThrow();
    expect(await repo.decisions(storeId)).toEqual([]);
  });
  it("does not repeat review for the same source occurrence", async () => {
    const { repo } = await setup();
    await repo.review(decision(), deviceId, randomUUID());
    await expect(
      repo.review(decision(), deviceId, randomUUID()),
    ).rejects.toThrow("COMMERCIAL_REVIEW_ALREADY_RECORDED");
  });
  it("preserves pending choices when another device's decision is pulled", async () => {
    const { repo, adapter } = await setup();
    const local = decision(),
      remote = decision({ decision: "DISMISSED", corrections: [] });
    await repo.review(local, deviceId, randomUUID());
    await applyCommercialReviewEntity(
      adapter,
      storeId,
      "commercial_review_decision",
      { id: remote.id, storeId, remoteVersion: 1, decision: remote },
    );
    const decisions = await repo.decisions(storeId);
    expect(decisions).toHaveLength(2);
    expect(decisions.find((d) => d.decision.id === local.id)?.state).toBe(
      "PENDING",
    );
    expect(reviewProgress([page], decisions)).toEqual({
      total: 1,
      examined: 1,
      remaining: 0,
    });
  });
  it("rejects immutable page edits and rolls back an invalid sync envelope/cursor", async () => {
    const { adapter, repo, db } = await setup();
    await expect(
      applyCommercialReviewEntity(adapter, storeId, "commercial_review_page", {
        ...page,
        checksum: "changed",
      }),
    ).rejects.toThrow("COMMERCIAL_REVIEW_IMMUTABLE_PAGE");
    await expect(
      applyPullPage(adapter, storeId, {
        changes: [
          {
            sequence: "1",
            entityType: "commercial_review_page",
            entityId: randomUUID(),
            entityVersion: 1,
            operation: "UPSERT",
            entity: page,
            changedAt: new Date().toISOString(),
          },
        ],
        nextCursor: "bad",
        hasMore: false,
        serverTime: new Date().toISOString(),
      }),
    ).rejects.toThrow("COMMERCIAL_REVIEW_ENVELOPE_INVALID");
    expect(
      db.prepare("SELECT cursor FROM sync_inbox_state").get(),
    ).toBeUndefined();
    expect(await repo.pages(storeId)).toEqual([page]);
  });
  it("resolves a recorded conflict explicitly while keeping the local audit payload", async () => {
    const { adapter, repo, db } = await setup();
    const local = decision(),
      remote = decision({ decision: "DISMISSED", corrections: [] });
    const commandId = randomUUID();
    await repo.review(local, deviceId, commandId);
    await applyCommercialReviewEntity(
      adapter,
      storeId,
      "commercial_review_decision",
      { id: remote.id, storeId, remoteVersion: 1, decision: remote },
    );
    await expect(
      repo.useRemoteDecision(storeId, local.id, remote.id),
    ).rejects.toThrow("COMMERCIAL_REVIEW_RESOLUTION_INVALID");
    db.prepare(
      "UPDATE sync_outbox SET status='CONFLICT' WHERE command_id=?",
    ).run(commandId);
    await repo.useRemoteDecision(storeId, local.id, remote.id);
    expect(await repo.decisions(storeId)).toEqual([
      { decision: remote, state: "SYNCED" },
    ]);
    const audit = db
      .prepare(
        "SELECT payload_json FROM commercial_review_decisions WHERE id=?",
      )
      .get(local.id) as { payload_json: string };
    expect(JSON.parse(audit.payload_json)).toEqual(local);
  });
  it("restores snapshots and decisions through bootstrap without removing offline choices", async () => {
    const { adapter, repo } = await setup();
    const local = decision();
    await repo.review(local, deviceId, randomUUID());
    const snapshot: BootstrapResponse = {
      protocolVersion: 1,
      store: { id: storeId },
      snapshotRevision: "snapshot",
      cursor: "cursor",
      serverTime: new Date().toISOString(),
      historyPolicy: { rawObservationDays: 90 },
      entities: {
        syncTestEntities: [],
        products: [],
        productIdentifiers: [],
        productAliases: [],
        needUnits: [],
        needMemberships: [],
        productSubstitutions: [],
        salesObservations: [],
        wasteObservations: [],
        commercialOperations: [],
        offers: [],
        marketSignals: [],
        executionInstructions: [],
        storeEvents: [],
        productDailyPerformance: [],
        departmentDailyPerformance: [],
        recommendations: [],
        decisions: [],
        actionExecutions: [],
        commercialReviewPages: [page],
        commercialReviewDecisions: [],
      },
    };
    await applyBootstrap(adapter, storeId, snapshot);
    expect((await repo.decisions(storeId))[0]?.decision.id).toBe(local.id);
    expect(await repo.pages(storeId)).toEqual([page]);
    expect(
      await adapter.getFirstAsync(
        "SELECT value FROM app_metadata WHERE key=?",
        `commercial-review:${storeId}`,
      ),
    ).toEqual({ value: "1" });
  });
});

function readablePage() {
  const p = structuredClone(page);
  p.blocks[0]!.fields[0]!.confidence = 0.95;
  p.blocks.push({ ...structuredClone(p.blocks[0]!), sourceBlockIndex: 5 });
  return p;
}
function groupInput(fixture: CommercialReviewPage) {
  return {
    storeId,
    sourceDocumentId,
    deviceId,
    reviewedAt: new Date().toISOString(),
    entries: fixture.blocks.map((b) => ({
      pageId: fixture.id,
      sourceBlockIndex: b.sourceBlockIndex,
      id: randomUUID(),
      commandId: randomUUID(),
    })),
  };
}
it("commits a readable group and its ordinary review commands atomically offline", async () => {
  const fixture = readablePage();
  const { repo, db } = await setup(":memory:", fixture);
  const before = JSON.stringify(await repo.pages(storeId));
  const input = groupInput(fixture);
  await repo.reviewReadableGroup(input);
  expect(await repo.decisions(storeId)).toHaveLength(2);
  expect(
    db
      .prepare("SELECT command_type FROM sync_outbox ORDER BY local_sequence")
      .all(),
  ).toEqual([
    { command_type: "COMMERCIAL_TRANSCRIPTION_REVIEW" },
    { command_type: "COMMERCIAL_TRANSCRIPTION_REVIEW" },
  ]);
  expect(JSON.stringify(await repo.pages(storeId))).toBe(before);
  expect(
    db.prepare("SELECT COUNT(*) AS count FROM sales_observations").get(),
  ).toEqual({ count: 0 });
  await expect(repo.reviewReadableGroup(input)).rejects.toThrow(
    "COMMERCIAL_GROUP_REVIEW_UNSAFE",
  );
  expect(await repo.decisions(storeId)).toHaveLength(2);
});
it("a mixed unsafe group writes neither decisions nor commands", async () => {
  const fixture = readablePage();
  fixture.blocks[1]!.fields[0]!.confidence = 0.5;
  const { repo, db } = await setup(":memory:", fixture);
  await expect(repo.reviewReadableGroup(groupInput(fixture))).rejects.toThrow(
    "COMMERCIAL_GROUP_REVIEW_UNSAFE",
  );
  expect(await repo.decisions(storeId)).toEqual([]);
  expect(db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get()).toEqual(
    { count: 0 },
  );
});
it("rolls back the whole group when a command insertion fails", async () => {
  const fixture = readablePage();
  const { repo, db } = await setup(":memory:", fixture);
  const input = groupInput(fixture);
  input.entries[1]!.commandId = input.entries[0]!.commandId;
  await expect(repo.reviewReadableGroup(input)).rejects.toThrow();
  expect(await repo.decisions(storeId)).toEqual([]);
  expect(db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get()).toEqual(
    { count: 0 },
  );
});
it("rechecks eligibility after an intervening review and preserves the earlier choice", async () => {
  const fixture = readablePage();
  const { repo, db } = await setup(":memory:", fixture);
  const input = groupInput(fixture);
  await repo.review(decision(), deviceId, randomUUID());
  await expect(repo.reviewReadableGroup(input)).rejects.toThrow(
    "COMMERCIAL_GROUP_REVIEW_UNSAFE",
  );
  expect(await repo.decisions(storeId)).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get()).toEqual(
    { count: 1 },
  );
});
