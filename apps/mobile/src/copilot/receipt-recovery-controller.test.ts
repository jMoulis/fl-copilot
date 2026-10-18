import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { nativeReceiptRecoveryFixture } from "../../../../scripts/test-receipt-recovery-fixtures";
import {
  ReceiptTestDatabase,
  receiptReviewDigest,
} from "../../../../scripts/test-receipt-publication-sqlite";
import { CopilotReceiptRecoveryController } from "./receipt-recovery-controller";
it.each(["RETRY_PROCESSING", "KEEP_BOTH", "CONFIRM_DUPLICATE"] as const)(
  "applies the reviewed recovery once offline, preserves originals/lines/numbers and replays after reopen (%s)",
  async (action) => {
    const directory = mkdtempSync(join(tmpdir(), "fl-recovery-")),
      path = join(directory, "native.db"),
      s = await nativeReceiptRecoveryFixture(action, path);
    let reopened: DatabaseSync | undefined;
    try {
      const r = s.recovery;
      expect(r.state.status).toBe("READY");
      const files = s.db.prepare("SELECT * FROM local_files ORDER BY id").all(),
        lines = s.db.prepare("SELECT * FROM waste_lines ORDER BY id").all(),
        commands = s.count("sync_outbox"),
        jobs = s.count("local_jobs");
      const result = await r.controller.confirm(
        r.message,
        r.request.basisHash,
        true,
      );
      expect(result.status).toBe("COMPLETED");
      const receipt = (await s.repo.getReceipt(r.receiptId))!;
      expect(receipt).toMatchObject(
        action === "RETRY_PROCESSING"
          ? { processingStatus: "UPLOAD_PENDING", aiStatus: "PENDING" }
          : action === "KEEP_BOTH"
            ? { duplicateStatus: "NOT_DUPLICATE" }
            : {
                duplicateStatus: "CONFIRMED_DUPLICATE",
                processingStatus: "CAPTURED",
              },
      );
      expect(
        s.db.prepare("SELECT * FROM local_files ORDER BY id").all(),
      ).toEqual(files);
      expect(
        s.db.prepare("SELECT * FROM waste_lines ORDER BY id").all(),
      ).toEqual(lines);
      expect(s.count("sync_outbox")).toBe(commands);
      expect(s.count("waste_observations")).toBe(0);
      expect(s.count("source_records")).toBe(0);
      expect(s.count("local_jobs")).toBe(
        jobs + (action === "KEEP_BOTH" ? 1 : 0),
      );
      const saved = s.db.prepare("SELECT * FROM local_jobs ORDER BY id").all();
      s.db.close();
      reopened = new DatabaseSync(path);
      const controller = new CopilotReceiptRecoveryController(
        new ReceiptTestDatabase(reopened),
        r.scope,
        receiptReviewDigest,
        randomUUID,
      );
      expect(
        (await controller.confirm(r.message, r.request.basisHash, true)).status,
      ).toBe("COMPLETED");
      expect(
        reopened.prepare("SELECT * FROM local_jobs ORDER BY id").all(),
      ).toEqual(saved);
      expect(
        reopened.prepare("SELECT COUNT(*) n FROM copilot_tool_results").get()!
          .n,
      ).toBe(1);
      r.scope.canRecoverWaste = false;
      await expect(controller.open(r.message)).rejects.toThrow();
    } finally {
      if (reopened) reopened.close();
      else s.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each([
  "PERMISSION",
  "REVIEW",
  "SOURCE",
  "RECEIPT",
  "JOB",
  "JOB_PAYLOAD",
  "FILE",
  "SYNC",
  "DELETED",
  "FORGED",
  "COMMIT",
  "CANCEL",
])(
  "refuses stale/unauthorized recovery or atomically rolls it back (%s)",
  async (mode) => {
    const s = await nativeReceiptRecoveryFixture();
    try {
      const r = s.recovery,
        abort = new AbortController();
      if (mode === "PERMISSION") r.scope.canRecoverWaste = false;
      if (mode === "SOURCE")
        await s.a.runAsync(
          "UPDATE source_documents SET checksum='changed' WHERE id=?",
          r.source.sourceDocumentId,
        );
      if (mode === "RECEIPT")
        await s.a.runAsync(
          "UPDATE waste_receipts SET version=version+1,confirmed_cashier_number='000999' WHERE id=?",
          r.receiptId,
        );
      if (mode === "JOB")
        await s.a.runAsync(
          "UPDATE local_jobs SET status='RUNNING' WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
        );
      if (mode === "JOB_PAYLOAD")
        await s.a.runAsync(
          "UPDATE local_jobs SET payload_json=json_set(payload_json,'$.localFileId',?) WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
          randomUUID(),
        );
      if (mode === "FILE")
        await s.a.runAsync(
          "UPDATE local_files SET checksum='changed' WHERE source_document_id=?",
          r.source.sourceDocumentId,
        );
      if (mode === "SYNC")
        await s.a.runAsync(
          "UPDATE waste_receipts SET sync_state='CONFLICT' WHERE id=?",
          r.receiptId,
        );
      if (mode === "DELETED")
        await s.a.runAsync(
          "DELETE FROM copilot_messages WHERE id=?",
          r.message.id,
        );
      let message = r.message;
      if (mode === "FORGED")
        message = {
          ...message,
          text: JSON.stringify({
            ...JSON.parse(message.text),
            input: { ...r.input, action: "CONFIRM_DUPLICATE" },
          }),
        };
      const jobBefore = s.db
          .prepare("SELECT * FROM local_jobs ORDER BY id")
          .all(),
        receiptBefore = await s.repo.getReceipt(r.receiptId),
        commands = s.count("sync_outbox");
      if (mode === "COMMIT") s.a.fail = true;
      if (mode === "CANCEL")
        s.a.afterRun = (sql) => {
          if (sql.includes("UPDATE local_jobs SET status = 'PENDING'"))
            abort.abort();
        };
      await expect(
        r.controller.confirm(
          message,
          r.request.basisHash,
          mode !== "REVIEW",
          abort.signal,
        ),
      ).rejects.toThrow();
      expect(
        s.db.prepare("SELECT * FROM local_jobs ORDER BY id").all(),
      ).toEqual(jobBefore);
      expect(await s.repo.getReceipt(r.receiptId)).toEqual(receiptBefore);
      expect(s.count("copilot_tool_results")).toBe(0);
      expect(s.count("sync_outbox")).toBe(commands);
      expect(s.count("waste_observations")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "CANDIDATE_SOURCE",
  "CANDIDATE_STORE",
  "CANDIDATE_RECEIPT",
  "CANDIDATE_FILE",
  "FILE_SOURCE",
  "CANDIDATE_FILE_SOURCE",
  "ACTIVE_JOB",
])(
  "requires a current owned exact-duplicate comparison and no active upload (%s)",
  async (mode) => {
    const s = await nativeReceiptRecoveryFixture("CONFIRM_DUPLICATE");
    try {
      const r = s.recovery;
      if (mode === "CANDIDATE_SOURCE")
        await s.a.runAsync(
          "UPDATE source_documents SET checksum='different' WHERE id=?",
          s.f.source.sourceDocumentId,
        );
      if (mode === "CANDIDATE_STORE")
        await s.a.runAsync(
          "UPDATE source_documents SET store_id=? WHERE id=?",
          randomUUID(),
          s.f.source.sourceDocumentId,
        );
      if (mode === "CANDIDATE_RECEIPT")
        await s.a.runAsync(
          "UPDATE waste_receipts SET sync_state='CONFLICT' WHERE id=?",
          s.f.p.receipt.id,
        );
      if (mode === "CANDIDATE_FILE")
        await s.a.runAsync(
          "UPDATE local_files SET retention_status='PURGED' WHERE source_document_id=?",
          s.f.source.sourceDocumentId,
        );
      if (mode === "FILE_SOURCE" || mode === "CANDIDATE_FILE_SOURCE")
        await s.a.runAsync(
          "UPDATE local_files SET source_document_id=? WHERE source_document_id=?",
          randomUUID(),
          mode === "FILE_SOURCE"
            ? r.source.sourceDocumentId
            : s.f.source.sourceDocumentId,
        );
      if (mode === "ACTIVE_JOB")
        await s.a.runAsync(
          "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,'SOURCE_UPLOAD_AND_REGISTER',?,'RUNNING',1,?,?)",
          randomUUID(),
          JSON.stringify({
            storeId: s.scope.storeId,
            sourceDocumentId: r.source.sourceDocumentId,
            localFileId: (await s.repo.getReceipt(r.receiptId))!.localFileId,
          }),
          new Date().toISOString(),
          new Date().toISOString(),
        );
      expect((await r.controller.open(r.message)).status).toBe("BLOCKED");
      await expect(
        r.controller.confirm(r.message, r.request.basisHash, true),
      ).rejects.toThrow();
      expect((await s.repo.getReceipt(r.receiptId))!.duplicateStatus).toBe(
        "POSSIBLE_DUPLICATE",
      );
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
it.each([
  "PUBLISHED",
  "COMPLETED",
  "PROCESSING",
  "DRAFT_LINES",
  "IRRECOVERABLE",
  "ALREADY_QUEUED",
])(
  "does not relaunch paid work for a protected or already queued ticket (%s)",
  async (mode) => {
    const s = await nativeReceiptRecoveryFixture();
    try {
      const r = s.recovery;
      if (mode === "PUBLISHED")
        await s.a.runAsync(
          "UPDATE waste_receipts SET processing_status='PUBLISHED' WHERE id=?",
          r.receiptId,
        );
      if (mode === "COMPLETED")
        await s.a.runAsync(
          "UPDATE waste_receipts SET ai_status='COMPLETED',processing_status='TO_VALIDATE' WHERE id=?",
          r.receiptId,
        );
      if (mode === "PROCESSING")
        await s.a.runAsync(
          "UPDATE waste_receipts SET ai_status='PROCESSING' WHERE id=?",
          r.receiptId,
        );
      if (mode === "DRAFT_LINES") {
        const { insertLine } =
          await import("../documents/waste-receipt-repository");
        await insertLine(s.a, {
          ...s.f.p.lines[0]!,
          receiptId: r.receiptId,
          syncState: "LOCAL_ONLY",
        });
      }
      if (mode === "IRRECOVERABLE")
        await s.a.runAsync(
          "UPDATE local_jobs SET last_error='SOURCE_UPLOAD_LOCAL_FILE_MISSING' WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
        );
      if (mode === "ALREADY_QUEUED") {
        await s.a.runAsync(
          "UPDATE local_jobs SET status='PENDING',last_error=NULL WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
        );
        await s.a.runAsync(
          "UPDATE waste_receipts SET processing_status='UPLOAD_PENDING',ai_status='PENDING' WHERE id=?",
          r.receiptId,
        );
      }
      const state = await r.controller.open(r.message);
      expect(state.status).toBe(
        mode === "PUBLISHED"
          ? "READ_ONLY"
          : mode === "ALREADY_QUEUED"
            ? "UNCHANGED"
            : "BLOCKED",
      );
      const jobs = s.db.prepare("SELECT * FROM local_jobs ORDER BY id").all();
      await r.controller
        .confirm(r.message, state.review!.basisHash, true)
        .catch(() => undefined);
      expect(
        s.db.prepare("SELECT * FROM local_jobs ORDER BY id").all(),
      ).toEqual(jobs);
      expect(s.count("copilot_tool_results")).toBe(0);
    } finally {
      s.db.close();
    }
  },
);
