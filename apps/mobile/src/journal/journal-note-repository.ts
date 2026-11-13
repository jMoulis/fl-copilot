import {
  journalNoteCapture,
  prepareJournalNote,
  sameJournalNote,
  storeJournalNoteSchema,
  withdrawJournalNote,
  type StoreJournalNote,
} from "@fl-copilot/domain";
import {
  OutboxRepository,
  type OutboxDatabase,
} from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
type Row = {
  payload_json: string;
  sync_state: string;
  remote_version: number | null;
};
export async function applyJournalNote(
  db: OutboxDatabase,
  storeId: string,
  raw: unknown,
) {
  const note = storeJournalNoteSchema.parse(raw);
  if (note.storeId !== storeId) throw Error("JOURNAL_NOTE_SCOPE_INVALID");
  const row = await db.getFirstAsync<Row & { store_id: string }>(
    "SELECT * FROM store_journal_notes WHERE id=?",
    note.id,
  );
  const previous = row
    ? storeJournalNoteSchema.parse(JSON.parse(row.payload_json))
    : null;
  if (row && (row.store_id !== storeId || !sameJournalNote(previous!, note)))
    throw Error("JOURNAL_NOTE_IDENTITY_CHANGED");
  // Withdrawal is monotone. A late creation acknowledgement cannot revive a note.
  if (previous && previous.version > note.version) {
    if ((row?.remote_version ?? 0) >= note.version) return;
    await db.runAsync(
      "UPDATE store_journal_notes SET remote_payload_json=?,remote_version=MAX(COALESCE(remote_version,0),?) WHERE id=? AND store_id=?",
      JSON.stringify(note),
      note.version,
      note.id,
      storeId,
    );
    return;
  }
  await db.runAsync(
    "INSERT INTO store_journal_notes(id,store_id,start_date,end_date,payload_json,remote_payload_json,remote_version,sync_state,dirty) VALUES(?,?,?,?,?,?,?,'SYNCED',0) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,remote_payload_json=excluded.remote_payload_json,remote_version=excluded.remote_version,sync_state='SYNCED',dirty=0",
    note.id,
    storeId,
    note.startDate,
    note.endDate ?? note.startDate,
    JSON.stringify(note),
    JSON.stringify(note),
    note.version,
  );
  await journalNoteHistory(db, note, `remote:${note.id}:${note.version}`);
}
async function journalNoteHistory(
  db: OutboxDatabase,
  note: StoreJournalNote,
  actionId: string,
) {
  await db.runAsync(
    "INSERT OR IGNORE INTO store_journal_note_history(action_id,note_id,store_id,payload_json,created_at) VALUES(?,?,?,?,?)",
    actionId,
    note.id,
    note.storeId,
    JSON.stringify(note),
    note.withdrawnAt ?? note.capturedAt,
  );
}
export class JournalNoteRepository {
  constructor(private db: OutboxDatabase & AtomicMutationDatabase) {}
  async list(
    storeId: string,
    date: string,
    afterId: string | null = null,
    includeWithdrawn = false,
  ) {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM store_journal_notes WHERE store_id=? AND start_date<=? AND end_date>=? AND (? IS NULL OR id>?) ${includeWithdrawn ? "" : "AND json_extract(payload_json,'$.withdrawnAt') IS NULL"} ORDER BY id LIMIT 26`,
      storeId,
      date,
      date,
      afterId,
      afterId,
    );
    const page = rows.slice(0, 25).map((r) => ({
      entity: storeJournalNoteSchema.parse(JSON.parse(r.payload_json)),
      syncState: r.sync_state,
    }));
    return {
      rows: page,
      hasMore: rows.length > 25,
      nextAfterId: rows.length > 25 ? page.at(-1)!.entity.id : null,
    };
  }
  async create(
    storeId: string,
    raw: unknown,
    ctx: {
      commandId: string;
      deviceId: string;
      assertCurrentScope?: () => void;
    },
  ) {
    const note = prepareJournalNote(storeId, raw);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      ctx.assertCurrentScope?.();
      const old = await tx.getFirstAsync<Row & { store_id: string }>(
        "SELECT * FROM store_journal_notes WHERE id=?",
        note.id,
      );
      if (old) {
        if (
          old.store_id !== storeId ||
          !sameJournalNote(
            storeJournalNoteSchema.parse(JSON.parse(old.payload_json)),
            note,
          )
        )
          throw Error("JOURNAL_NOTE_IDENTITY_CHANGED");
        return;
      }
      await tx.runAsync(
        "INSERT INTO store_journal_notes(id,store_id,start_date,end_date,payload_json,sync_state,dirty) VALUES(?,?,?,?,?,'PENDING',1)",
        note.id,
        storeId,
        note.startDate,
        note.endDate ?? note.startDate,
        JSON.stringify(note),
      );
      await journalNoteHistory(tx, note, ctx.commandId);
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId,
        commandType: "CREATE_JOURNAL_NOTE",
        entityType: "store_journal_note",
        entityId: note.id,
        expectedRemoteVersion: null,
        payload: journalNoteCapture(note),
        createdAt: note.capturedAt,
      });
      ctx.assertCurrentScope?.();
    });
    return note;
  }
  async withdraw(
    storeId: string,
    id: string,
    ctx: {
      commandId: string;
      deviceId: string;
      capturedAt: string;
      assertCurrentScope?: () => void;
    },
  ) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      ctx.assertCurrentScope?.();
      const row = await tx.getFirstAsync<Row>(
        "SELECT * FROM store_journal_notes WHERE id=? AND store_id=?",
        id,
        storeId,
      );
      if (!row) throw Error("JOURNAL_NOTE_MISSING");
      const old = storeJournalNoteSchema.parse(JSON.parse(row.payload_json));
      if (old.withdrawnAt) return;
      const note = withdrawJournalNote(old, ctx.capturedAt);
      await tx.runAsync(
        "UPDATE store_journal_notes SET payload_json=?,sync_state='PENDING',dirty=1 WHERE id=? AND store_id=?",
        JSON.stringify(note),
        id,
        storeId,
      );
      await journalNoteHistory(tx, note, ctx.commandId);
      await new OutboxRepository(tx).enqueue({
        commandId: ctx.commandId,
        deviceId: ctx.deviceId,
        storeId,
        commandType: "WITHDRAW_JOURNAL_NOTE",
        entityType: "store_journal_note",
        entityId: id,
        expectedRemoteVersion: 1,
        payload: {
          withdrawnAt: note.withdrawnAt,
          capture: journalNoteCapture(old),
        },
        createdAt: ctx.capturedAt,
      });
      ctx.assertCurrentScope?.();
    });
  }
}
