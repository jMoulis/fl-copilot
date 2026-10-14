import {
  mercalysArchiveInputSchema,
  mercalysArchiveSchema,
  mercalysArchiveOutcomeSchema,
  type MercalysArchiveInput,
  type MercalysArchiveOutcome,
} from "@fl-copilot/domain";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
export class MercalysArchiveRepository {
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    readonly scope: { storeId: string; ownerId: string },
  ) {}
  private async read(tx: OutboxDatabase, id: string) {
    const row = await tx.getFirstAsync<{
      payload_json: string;
      request_json: string;
    }>(
      "SELECT payload_json,request_json FROM mercalys_intake_archives WHERE id=? AND store_id=? AND owner_id=?",
      id,
      this.scope.storeId,
      this.scope.ownerId,
    );
    if (!row) throw Error("MERCALYS_ARCHIVE_UNAVAILABLE");
    const a = mercalysArchiveSchema.parse(JSON.parse(row.payload_json));
    if (
      JSON.stringify(mercalysArchiveInputSchema.strip().parse(a)) !==
      JSON.stringify(
        mercalysArchiveInputSchema.parse(JSON.parse(row.request_json)),
      )
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
    if (
      a.id !== id ||
      a.storeId !== this.scope.storeId ||
      a.ownerId !== this.scope.ownerId
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
    return a;
  }
  get(id: string) {
    return this.read(this.db, id);
  }
  async create(raw: MercalysArchiveInput) {
    const a = mercalysArchiveInputSchema.parse(raw);
    if (a.storeId !== this.scope.storeId || a.ownerId !== this.scope.ownerId)
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const existing = await tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM mercalys_intake_archives WHERE id=?",
        a.id,
      );
      if (existing) {
        const owned = await this.read(tx, a.id);
        if (
          JSON.stringify(mercalysArchiveInputSchema.strip().parse(owned)) !==
          JSON.stringify(a)
        )
          throw Error("MERCALYS_ARCHIVE_ID_REUSED");
        return;
      }
      const record = mercalysArchiveSchema.parse({
        ...a,
        version: 1,
        updatedAt: a.createdAt,
        outcome: { status: "RETAINED" },
      });
      await tx.runAsync(
        "INSERT INTO mercalys_intake_archives(id,store_id,owner_id,request_json,payload_json,created_at) VALUES(?,?,?,?,?,?)",
        a.id,
        a.storeId,
        a.ownerId,
        JSON.stringify(a),
        JSON.stringify(record),
        a.createdAt,
      );
    });
    return a.id;
  }
  async finish(id: string, version: number, raw: MercalysArchiveOutcome) {
    const outcome = mercalysArchiveOutcomeSchema.parse(raw);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      const a = await this.read(tx, id);
      if (a.version !== version) throw Error("MERCALYS_ARCHIVE_CHANGED");
      await tx.runAsync(
        "UPDATE mercalys_intake_archives SET payload_json=? WHERE id=?",
        JSON.stringify({
          ...a,
          version: a.version + 1,
          updatedAt: new Date().toISOString(),
          outcome,
        }),
        id,
      );
    });
    return this.get(id);
  }
  async recent(after?: { createdAt: string; id: string }) {
    const rows = await this.db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM mercalys_intake_archives WHERE store_id=? AND owner_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 11",
      this.scope.storeId,
      this.scope.ownerId,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.createdAt ?? null,
      after?.id ?? null,
    );
    const archives = rows
      .slice(0, 10)
      .map((r) => mercalysArchiveSchema.parse(JSON.parse(r.payload_json)));
    if (
      archives.some(
        (a) =>
          a.storeId !== this.scope.storeId || a.ownerId !== this.scope.ownerId,
      )
    )
      throw Error("MERCALYS_ARCHIVE_SCOPE_INVALID");
    return { archives, hasMore: rows.length > 10 };
  }
}
