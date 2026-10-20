import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { chatImportFixture } from "../../../../scripts/test-chat-import-fixtures";
import { mercalysWorkbook } from "../../../../scripts/test-mercalys-sync-fixtures";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import {
  serializeEmailIntakeOriginalMetadata,
  type EmailIntakeReceipt,
} from "@fl-copilot/sync-contracts";
import { CopilotMercalysImportController } from "../copilot/mercalys-import-controller";
import { CopilotConversationRepository } from "../copilot/conversation-repository";
import { sourceOriginalHash } from "../documents/source-original-hash";
import {
  EmailIntakeCache,
  type EmailIntakeSession,
} from "./email-intake-cache";
import {
  EmailDecisionRepository,
  applyEmailDecisionRecord,
} from "./email-decision-repository";
import { EmailOriginalTransfer } from "./email-original-transfer";
import { EmailMercalysHandoff } from "./email-mercalys-handoff";
import {
  EmailIntakeProcessing,
  emailProcessingFormat,
} from "./email-intake-processing";
import { SourceOriginalJobs } from "../documents/source-original-jobs";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { MercalysBatchRepository } from "../documents/mercalys-batch-repository";
import { serializeLocalWrites } from "../db/serialized-writes";
import type { MercalysZipStorage } from "../documents/mercalys-zip-capture";
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
async function fixture(
  options: {
    zip?: boolean;
    invalidMember?: boolean;
    emptyMember?: boolean;
    synced?: boolean;
    flow?: "MERCALYS_SALES" | "MERCALYS_WASTE";
    filename?: string;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "fl-email-canonical-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "local.db"),
    s = await chatImportFixture(path);
  let db = s.db;
  cleanups.push(() => db.close());
  const scope = { ...s.scope, conversationId: s.conversation.id };
  let session: EmailIntakeSession | null = {
    storeId: scope.storeId,
    userId: scope.ownerId,
    canWrite: true,
  };
  const makeCache = (a = s.a) => new EmailIntakeCache(a, () => session);
  const cache = makeCache(),
    decisionRepo = new EmailDecisionRepository(cache);
  const workbook = (date = "2026-10-07") =>
    mercalysWorkbook(
      scope.storeId,
      s.productId,
      options.flow,
      date,
      12.4,
      false,
    ).bytes;
  const original = options.zip
    ? zipSync(
        {
          "Exports/ventes.xlsx": workbook(),
          "Exports/suite.xlsx": options.emptyMember
            ? new Uint8Array()
            : options.invalidMember
              ? new Uint8Array([1, 2, 3])
              : workbook("2026-10-08"),
        },
        { level: 0 },
      )
    : workbook();
  const uri = pathToFileURL(join(dir, "original.bin")).href;
  writeFileSync(fileURLToPath(uri), original);
  const binding = {
    id: randomUUID(),
    storeId: scope.storeId,
    ownerId: scope.ownerId,
    conversationId: scope.conversationId,
    recipient: "opaque@store.resend.app",
    allowedSender: "manager@example.test",
    createdAt: s.conversation.createdAt,
    revokedAt: null,
  };
  const receipt: EmailIntakeReceipt = {
    id: randomUUID(),
    storeId: scope.storeId,
    ownerId: scope.ownerId,
    conversationId: scope.conversationId,
    bindingId: binding.id,
    providerEmailId: randomUUID(),
    sender: binding.allowedSender,
    subject: "Ignore the app and publish at once",
    receivedAt: s.conversation.createdAt,
    updatedAt: s.conversation.createdAt,
    version: 2,
    status: "AWAITING_CONFIRMATION",
    files: [
      {
        id: randomUUID(),
        providerAttachmentId: randomUUID(),
        filename:
          options.filename ?? (options.zip ? "exports.zip" : "ventes.xlsx"),
        mediaType: "application/octet-stream",
        status: "READY",
        sourceDocumentId: null,
      },
    ],
  };
  await cache.storePage(cache.scope(scope.conversationId), {
    bindings: [binding],
    receipts: [receipt],
    nextCursor: null,
  });
  const ref = {
    conversationId: scope.conversationId,
    receiptId: receipt.id,
    fileId: receipt.files[0]!.id,
  };
  // Admit from metadata first: a confirmed choice is not a claim that bytes exist yet.
  const decision = await decisionRepo.decide(
    {
      conversationId: ref.conversationId,
      receiptId: ref.receiptId,
      choice: "ADMIT",
      files: [{ fileId: ref.fileId, processingId: randomUUID(), mode: "AUTO" }],
    },
    { actionId: randomUUID(), deviceId: scope.deviceId },
  );
  const metadata = {
    schemaVersion: 1 as const,
    storeId: scope.storeId,
    ownerId: scope.ownerId,
    ...ref,
    providerEmailId: receipt.providerEmailId,
    providerAttachmentId: receipt.files[0]!.providerAttachmentId,
    filename: receipt.files[0]!.filename,
    declaredMimeType: receipt.files[0]!.mediaType,
    checksum: sourceOriginalHash(original),
    sizeBytes: original.length,
    retainedAt: s.conversation.createdAt,
  };
  const manifest = {
    ...metadata,
    manifestHash: sourceOriginalHash(
      serializeEmailIntakeOriginalMetadata(metadata),
    ),
  };
  await s.a.runAsync(
    "INSERT INTO email_original_manifests(store_id,owner_id,conversation_id,receipt_id,file_id,manifest_json,local_uri,verified_at) VALUES(?,?,?,?,?,?,?,?)",
    scope.storeId,
    scope.ownerId,
    ref.conversationId,
    ref.receiptId,
    ref.fileId,
    JSON.stringify(manifest),
    uri,
    manifest.retainedAt,
  );
  if (options.synced !== false)
    await applyEmailDecisionRecord(s.a, scope, decision, 1);
  const read = async (local: string) =>
    new Uint8Array(readFileSync(fileURLToPath(local)));
  let failMember = false;
  const zip: MercalysZipStorage = {
    retain: vi.fn(async () => {
      throw Error("must reuse original");
    }),
    read,
    checksum: async (bytes) => sourceOriginalHash(bytes),
    memberId: async (parent, name) => {
      const h = sourceOriginalHash(`${parent}/${name}`).slice(7);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    },
    member: vi.fn(async (bytes, id) => {
      if (failMember) {
        failMember = false;
        throw Error("storage interrupted");
      }
      const file = join(dir, `${id}.xlsx`);
      if (existsSync(file))
        expect(sourceOriginalHash(readFileSync(file))).toBe(
          sourceOriginalHash(bytes),
        );
      else writeFileSync(file, bytes);
      return {
        localUri: pathToFileURL(file).href,
        sizeBytes: bytes.length,
        checksum: sourceOriginalHash(bytes),
      };
    }),
    pause: async () => undefined,
  };
  const originals = (c: EmailIntakeCache) =>
    new EmailOriginalTransfer(
      c,
      {
        manifest: async () => {
          throw Error("no network");
        },
        download: async () => {
          throw Error("no network");
        },
      },
      {
        hash: async (text) => sourceOriginalHash(text),
        receive: async () => {
          throw Error("no network");
        },
        existing: async (m) => {
          if (!existsSync(fileURLToPath(uri))) return null;
          const b = await read(uri);
          if (sourceOriginalHash(b) !== m.checksum || b.length !== m.sizeBytes)
            throw Error("original damaged");
          return { localUri: uri };
        },
      },
    );
  const deps = { read: vi.fn(read), zip };
  const makeHandoff = (c = cache) =>
    new EmailMercalysHandoff(c, originals(c), scope.deviceId, deps);
  const engine = (a = s.a, authorize?: (db: OutboxDatabase) => Promise<void>) =>
    new CopilotMercalysImportController(a, scope, {
      ...s.deps,
      authorize,
      read: async (local) => s.bytes.get(local) ?? read(local),
    });
  return {
    ...s,
    dir,
    path,
    scope,
    cache,
    originals,
    ref,
    receipt,
    decision,
    manifest,
    uri,
    deps,
    workbook,
    zip,
    handoff: makeHandoff(),
    makeHandoff,
    engine,
    makeCache,
    setSession: (value: EmailIntakeSession | null) => {
      session = value;
    },
    failNextMember: () => {
      failMember = true;
    },
    restart: () => {
      db.close();
      db = new DatabaseSync(path);
      return new ReceiptTestDatabase(db);
    },
  };
}
function count(s: Awaited<ReturnType<typeof fixture>>, table: string) {
  return Number(s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
}
it.each(["MERCALYS_SALES", "MERCALYS_WASTE"] as const)(
  "hands verified email bytes to the existing %s engine, preserves the draft and publishes once",
  async (flow) => {
    const f = await fixture({ flow });
    await f.chat.editText(f.conversation.id, "Mon brouillon reste ici");
    const [result, concurrent] = await Promise.all([
      f.handoff.attach(f.ref),
      f.handoff.attach(f.ref),
    ]);
    expect(concurrent).toEqual(result);
    if (result.status !== "ATTACHED") throw Error("expected actual handoff");
    expect(result.message.text).not.toContain(f.receipt.subject);
    expect((await f.repo.draft(f.conversation.id))?.text).toBe(
      "Mon brouillon reste ici",
    );
    expect(count(f, "source_documents")).toBe(0);
    const report = await f.engine().run(result.message);
    expect(report.items[0]?.status).toBe("PUBLISHED");
    const observations = count(
      f,
      flow === "MERCALYS_SALES" ? "sales_observations" : "waste_observations",
    );
    expect(observations).toBe(1);
    const commands = count(f, "sync_outbox");
    await f
      .engine()
      .run(((await f.handoff.attach(f.ref)) as typeof result).message);
    expect(count(f, "sync_outbox")).toBe(commands);
    expect(f.calls()).toBe(0);
    expect(existsSync(fileURLToPath(f.uri))).toBe(true);
  },
);
it("does not turn an unsynchronized admission into an import", async () => {
  const f = await fixture({ synced: false });
  await expect(f.handoff.attach(f.ref)).rejects.toThrow(
    "EMAIL_INTAKE_DECISION_SYNC_REQUIRED",
  );
  expect(f.deps.read).not.toHaveBeenCalled();
  expect(count(f, "mercalys_intake_batches")).toBe(0);
});
it("restores the same handoff after a physical SQLite close/reopen without a network or new IDs", async () => {
  const f = await fixture(),
    first = await f.handoff.attach(f.ref);
  const a = f.restart(),
    cache = f.makeCache(a),
    result = await f.makeHandoff(cache).attach(f.ref);
  expect(result).toEqual(first);
  expect(
    (
      await new CopilotConversationRepository(a, f.scope).messages(
        f.conversation.id,
      )
    ).messages,
  ).toHaveLength(1);
});
it("processes good members immediately and retains the same ordered manifest/card after a missing copy resumes", async () => {
  const f = await fixture({ zip: true });
  f.failNextMember();
  const partial = await f.handoff.attach(f.ref);
  expect(partial).toMatchObject({
    status: "ATTACHED",
    failures: [expect.objectContaining({ path: "Exports/ventes.xlsx" })],
  });
  if (partial.status !== "ATTACHED")
    throw Error("expected partial import card");
  const first = await f.engine().run(partial.message);
  expect(first.items.map((item) => item.status)).toEqual([
    "ERROR",
    "PUBLISHED",
  ]);
  expect(count(f, "sales_observations")).toBe(1);
  const before = await new MercalysBatchRepository(f.a, f.scope).header(
    partial.batchId,
  );
  expect(
    before.files.map((file) => [file.filename, file.localUri === null]),
  ).toEqual([
    ["Exports/ventes.xlsx", true],
    ["Exports/suite.xlsx", false],
  ]);
  expect(count(f, "copilot_messages")).toBe(2);
  const resumed = await f.handoff.attach(f.ref);
  if (resumed.status !== "ATTACHED")
    throw Error("expected completed extraction");
  expect(resumed.message).toEqual(partial.message);
  expect(
    (await f.engine().run(resumed.message)).items.map((item) => item.status),
  ).toEqual(["PUBLISHED", "PUBLISHED"]);
  expect(count(f, "sales_observations")).toBe(2);
  const commands = count(f, "sync_outbox");
  await f
    .engine()
    .run(((await f.handoff.attach(f.ref)) as typeof resumed).message);
  expect(count(f, "sync_outbox")).toBe(commands);
  expect(count(f, "mercalys_intake_batches")).toBe(1);
  expect(f.zip.retain).not.toHaveBeenCalled();
});
it("does not double-publish a file already imported normally in this store", async () => {
  const f = await fixture(),
    normal = await f.add({ review: false });
  await f.controller.run(normal.message);
  const result = await f.handoff.attach(f.ref);
  if (result.status !== "ATTACHED") throw Error("expected actual handoff");
  expect((await f.engine().run(result.message)).items[0]).toMatchObject({
    status: "PUBLISHED",
    alreadyPublished: true,
  });
  expect(count(f, "sales_observations")).toBe(1);
});
it("reconstructs a missing extracted workbook from the retained ZIP without republishing", async () => {
  const f = await fixture({ zip: true }),
    first = await f.handoff.attach(f.ref);
  if (first.status !== "ATTACHED") throw Error("expected actual handoff");
  await f.engine().run(first.message);
  const batch = await new (
    await import("../documents/mercalys-batch-repository")
  ).MercalysBatchRepository(f.a, f.scope).header(first.batchId);
  const lost = batch.files[0]!.localUri;
  if (!lost) throw Error("expected retained member location");
  rmSync(fileURLToPath(lost));
  expect(existsSync(fileURLToPath(lost))).toBe(false);
  const restored = await f.handoff.attach(f.ref);
  expect(restored).toEqual(first);
  expect(existsSync(fileURLToPath(lost))).toBe(true);
  await f.engine().run(first.message);
  expect(count(f, "sales_observations")).toBe(2);
});
it("keeps a corrected overlap in the existing review path rather than adding or replacing its values", async () => {
  const f = await fixture(),
    normal = await f.add({ review: false, sales: 20 });
  await f.controller.run(normal.message);
  const before = f.db.prepare("SELECT * FROM sales_observations").all();
  const result = await f.handoff.attach(f.ref);
  if (result.status !== "ATTACHED") throw Error("expected actual handoff");
  expect((await f.engine().run(result.message)).items[0]?.status).toBe(
    "REVIEW",
  );
  expect(f.db.prepare("SELECT * FROM sales_observations").all()).toEqual(
    before,
  );
  expect(count(f, "source_documents")).toBe(1);
});
it("requests verified recovery instead of importing a lost local file or another owner's attachment", async () => {
  const f = await fixture();
  rmSync(fileURLToPath(f.uri));
  await expect(f.handoff.attach(f.ref)).rejects.toThrow(
    "EMAIL_ORIGINAL_RECOVERY_REQUIRED",
  );
  f.setSession({
    storeId: f.scope.storeId,
    userId: randomUUID(),
    canWrite: true,
  });
  await expect(f.handoff.attach(f.ref)).rejects.toThrow(
    "EMAIL_INTAKE_CONVERSATION_UNAVAILABLE",
  );
  expect(count(f, "mercalys_intake_batches")).toBe(0);
});
it("rejects a change of actor after the actual byte read without committing the handoff", async () => {
  const f = await fixture();
  const read = f.deps.read.getMockImplementation()!;
  f.deps.read.mockImplementationOnce(async (uri) => {
    const bytes = await read(uri);
    f.setSession({
      storeId: randomUUID(),
      userId: f.scope.ownerId,
      canWrite: true,
    });
    return bytes;
  });
  await expect(f.handoff.attach(f.ref)).rejects.toThrow(
    "EMAIL_INTAKE_SCOPE_CHANGED",
  );
  expect(count(f, "mercalys_intake_batches")).toBe(0);
});
it("does not redirect an AUTO image to the Mercalys or waste engine", async () => {
  const f = await fixture({ filename: "rayon.jpg" });
  await expect(f.handoff.attach(f.ref)).rejects.toThrow(
    "EMAIL_MERCALYS_FORMAT_REQUIRED",
  );
  expect(f.deps.read).not.toHaveBeenCalled();
  expect(count(f, "source_documents")).toBe(0);
});
it.each(["ROLE", "ARCHIVE", "DAMAGED", "ORIGIN"] as const)(
  "retains the original and refuses %s before canonical effects",
  async (failure) => {
    const f = await fixture();
    if (failure === "ROLE") f.setSession(null);
    if (failure === "ARCHIVE")
      await f.a.runAsync(
        "UPDATE copilot_conversations SET payload_json=json_set(payload_json,'$.status','ARCHIVED')",
      );
    if (failure === "DAMAGED")
      writeFileSync(fileURLToPath(f.uri), Buffer.from("not the original"));
    if (failure === "ORIGIN")
      await f.a.runAsync(
        "UPDATE email_intake_decisions SET payload_json=json_set(payload_json,'$.actionId',?)",
        randomUUID(),
      );
    if (failure === "ORIGIN") {
      // An immutable action changed before handoff: a known accepted manifest still
      // cannot make a foreign stored decision match the old acknowledged JSON.
      await f.a.runAsync(
        "UPDATE email_intake_decisions SET sync_state='CONFLICT'",
      );
    }
    await expect(f.handoff.attach(f.ref)).rejects.toThrow();
    expect(count(f, "mercalys_intake_batches")).toBe(0);
    expect(count(f, "source_documents")).toBe(0);
    expect(existsSync(fileURLToPath(f.uri))).toBe(true);
  },
);
it("rechecks the accepted decision inside the normal publication proof", async () => {
  const f = await fixture(),
    result = await f.handoff.attach(f.ref);
  if (result.status !== "ATTACHED") throw Error("expected actual handoff");
  await f.a.runAsync("UPDATE email_intake_decisions SET sync_state='CONFLICT'");
  await expect(f.engine().run(result.message)).rejects.toThrow(
    "EMAIL_INTAKE_DECISION_SYNC_REQUIRED",
  );
  expect(count(f, "source_documents")).toBe(0);
});
it("stops a previously attached file when its remote envelope is quarantined", async () => {
  const f = await fixture(),
    result = await f.handoff.attach(f.ref);
  if (result.status !== "ATTACHED") throw Error("expected actual handoff");
  await f.cache.storePage(f.cache.scope(f.conversation.id), {
    bindings: [],
    receipts: [{ ...f.receipt, version: 3, status: "QUARANTINED" }],
    nextCursor: null,
  });
  await expect(f.engine().run(result.message)).rejects.toThrow(
    "EMAIL_INTAKE_PROCESSING_FORBIDDEN",
  );
  expect(count(f, "source_documents")).toBe(0);
});
it("checks current ownership again after byte reads and rolls back a role loss during message commit", async () => {
  const f = await fixture();
  f.a.afterRun = (sql) => {
    if (sql.startsWith("INSERT INTO copilot_messages")) f.setSession(null);
  };
  await expect(f.handoff.attach(f.ref)).rejects.toThrow(
    "EMAIL_INTAKE_SCOPE_CHANGED",
  );
  expect(count(f, "copilot_messages")).toBe(0);
  expect(count(f, "source_documents")).toBe(0);
  expect(existsSync(fileURLToPath(f.uri))).toBe(true);
});

function durableEmailRuntime(f: Awaited<ReturnType<typeof fixture>>) {
  const scope = () => ({
    storeId: f.scope.storeId,
    userId: f.scope.ownerId,
    canWrite: true,
  });
  const make = (db = f.a, now?: () => Date) => {
    const cache = f.makeCache(db),
      originals = f.originals(cache),
      runtime = new EmailIntakeProcessing(cache, originals, {
        session: scope,
        receipt: async () => {
          throw Error("UNEXPECTED_NETWORK");
        },
        format: async (proof) =>
          emailProcessingFormat(await f.deps.read(proof.localUri)),
        mercalys: f.makeHandoff(cache),
        media: {
          capture: async () => {
            throw Error("WRONG_PIPELINE");
          },
        },
        runMercalys: (message, authorize, signal) =>
          f.engine(db, authorize).run(message, signal),
      }),
      jobs = new SourceOriginalJobs(
        db,
        {
          recover: async () => {
            throw Error("UNEXPECTED_TRANSFER");
          },
        },
        scope,
        randomUUID,
        now,
        originals,
        {
          process: (input, authorize, signal) =>
            runtime.process(input, authorize, signal),
        },
      );
    return { runtime, jobs, db };
  };
  return make;
}
it.each([
  { zip: false, filename: "ventes.xlsx", expected: 1 },
  { zip: false, filename: "photo-rayon.jpg", expected: 1 },
  { zip: true, filename: "archive.pdf", expected: 2 },
])(
  "durably runs admitted bytes through the ordinary import engine despite filename $filename",
  async ({ zip, filename, expected }) => {
    const f = await fixture({ zip, filename });
    await f.chat.editText(f.conversation.id, "Mon brouillon est conservé");
    const make = durableEmailRuntime(f);
    const p = make(),
      input = {
        ...f.ref,
        actionId: f.decision.actionId,
        processingId: f.decision.files[0]!.processingId,
      };
    expect(await p.runtime.seed(f.scope.storeId, f.scope.ownerId, p.jobs)).toBe(
      1,
    );
    await p.jobs.process(f.scope.storeId, f.scope.ownerId);
    expect(await p.jobs.emailProcessingState(input)).toMatchObject({
      status: "COMPLETED",
      attempts: 1,
    });
    expect(count(f, "sales_observations")).toBe(expected);
    expect((await f.repo.draft(f.conversation.id))?.text).toBe(
      "Mon brouillon est conservé",
    );
    expect(f.calls()).toBe(0);
    const before = count(f, "sync_outbox"),
      resumed = make(f.restart());
    expect(
      await resumed.runtime.seed(
        f.scope.storeId,
        f.scope.ownerId,
        resumed.jobs,
      ),
    ).toBe(0);
    await resumed.jobs.requestEmailProcessing(input, true);
    await resumed.jobs.process(f.scope.storeId, f.scope.ownerId);
    expect(await resumed.jobs.emailProcessingState(input)).toMatchObject({
      status: "COMPLETED",
      attempts: 2,
    });
    expect(
      await resumed.db.getFirstAsync(
        "SELECT COUNT(*) n FROM sales_observations",
      ),
    ).toEqual({ n: expected });
    expect(
      await resumed.db.getFirstAsync("SELECT COUNT(*) n FROM sync_outbox"),
    ).toEqual({ n: before });
    expect(existsSync(fileURLToPath(f.uri))).toBe(true);
  },
);

it("keeps one publication when the import card and durable job run the same accepted file together", async () => {
  const f = await fixture(),
    handoff = await f.handoff.attach(f.ref);
  if (handoff.status !== "ATTACHED") throw Error("expected handoff");
  // Expo gives the callback a transaction handle distinct from the queued facade.
  const facade = {
    ...f.a,
    execAsync: f.a.execAsync.bind(f.a),
    runAsync: f.a.runAsync.bind(f.a),
    getFirstAsync: f.a.getFirstAsync.bind(f.a),
    getAllAsync: f.a.getAllAsync.bind(f.a),
    withExclusiveTransactionAsync: f.a.withExclusiveTransactionAsync.bind(f.a),
  };
  // Test adapter implements the variadic SQL subset used by this production path.
  const db = serializeLocalWrites(
    facade as unknown as Parameters<typeof serializeLocalWrites>[0],
  ) as unknown as typeof facade;
  const [a, b] = await Promise.all([
    f.engine(db).run(handoff.message),
    f.engine(db).run(handoff.message),
  ]);
  expect(a.items[0]?.status).toBe("PUBLISHED");
  expect(b.items[0]?.status).toBe("PUBLISHED");
  expect(count(f, "sales_observations")).toBe(1);
});

it("publishes a good ZIP sibling before copy retry, then finishes after restart without a new card or double publication", async () => {
  const f = await fixture({ zip: true }),
    make = durableEmailRuntime(f);
  let at = new Date("2026-10-20T18:00:00Z");
  const p = make(f.a, () => at),
    input = {
      ...f.ref,
      actionId: f.decision.actionId,
      processingId: f.decision.files[0]!.processingId,
    };
  f.failNextMember();
  await p.runtime.seed(f.scope.storeId, f.scope.ownerId, p.jobs);
  await p.jobs.process(f.scope.storeId, f.scope.ownerId);
  expect(await p.jobs.emailProcessingState(input)).toMatchObject({
    status: "RETRY",
    attempts: 1,
    code: "EMAIL_MERCALYS_MEMBERS_RETRY_REQUIRED",
  });
  expect(count(f, "sales_observations")).toBe(1);
  const originalMessage = f.db
    .prepare(
      "SELECT id,payload_json FROM copilot_messages WHERE json_extract(payload_json,'$.role')='USER' AND json_extract(json_extract(payload_json,'$.text'),'$.kind')='MERCALYS_CHAT_IMPORT'",
    )
    .get();
  const resumed = make(f.restart(), () => at);
  at = new Date(at.getTime() + 120000);
  await resumed.jobs.process(f.scope.storeId, f.scope.ownerId);
  expect(await resumed.jobs.emailProcessingState(input)).toMatchObject({
    status: "COMPLETED",
    attempts: 2,
  });
  expect(
    await resumed.db.getFirstAsync("SELECT COUNT(*) n FROM sales_observations"),
  ).toEqual({ n: 2 });
  expect(
    await resumed.db.getAllAsync(
      "SELECT id,payload_json FROM copilot_messages WHERE json_extract(payload_json,'$.role')='USER' AND json_extract(json_extract(payload_json,'$.text'),'$.kind')='MERCALYS_CHAT_IMPORT'",
    ),
  ).toEqual([originalMessage]);
  expect(f.zip.retain).not.toHaveBeenCalled();
  expect(existsSync(fileURLToPath(f.uri))).toBe(true);
});
it("keeps a malformed workbook visible for review while publishing its valid sibling", async () => {
  const f = await fixture({ zip: true, invalidMember: true }),
    make = durableEmailRuntime(f),
    p = make();
  const input = {
    ...f.ref,
    actionId: f.decision.actionId,
    processingId: f.decision.files[0]!.processingId,
  };
  await p.runtime.seed(f.scope.storeId, f.scope.ownerId, p.jobs);
  await p.jobs.process(f.scope.storeId, f.scope.ownerId);
  expect(await p.jobs.emailProcessingState(input)).toMatchObject({
    status: "WAITING_INPUT",
    code: "EMAIL_MERCALYS_PARTIAL_REVIEW_REQUIRED",
  });
  expect(count(f, "sales_observations")).toBe(1);
  const batch = (await new MercalysBatchRepository(f.a, f.scope).recent())
    .batches[0]!;
  expect(batch.files.map((file) => file.localUri === null)).toEqual([
    false,
    true,
  ]);
  const linked = await f.handoff.attach(f.ref);
  if (linked.status !== "ATTACHED") throw Error("expected partial card");
  expect(linked.failures).toEqual([
    { path: "Exports/suite.xlsx", code: "MERCALYS_ZIP_WORKBOOK_INVALID" },
  ]);
  expect(
    (await f.engine().run(linked.message)).items.map((item) => item.status),
  ).toEqual(["PUBLISHED", "ERROR"]);
  expect(count(f, "sales_observations")).toBe(1);
});

it("does not let an empty workbook block its valid sibling or fabricate a retained member URI", async () => {
  const f = await fixture({ zip: true, emptyMember: true }),
    p = durableEmailRuntime(f)();
  const input = {
    ...f.ref,
    actionId: f.decision.actionId,
    processingId: f.decision.files[0]!.processingId,
  };
  await p.runtime.seed(f.scope.storeId, f.scope.ownerId, p.jobs);
  await p.jobs.process(f.scope.storeId, f.scope.ownerId);
  expect(await p.jobs.emailProcessingState(input)).toMatchObject({
    status: "WAITING_INPUT",
    code: "EMAIL_MERCALYS_PARTIAL_REVIEW_REQUIRED",
  });
  expect(count(f, "sales_observations")).toBe(1);
  const batch = (await new MercalysBatchRepository(f.a, f.scope).recent())
    .batches[0]!;
  expect(batch.files.map((file) => file.filename)).toEqual([
    "Exports/ventes.xlsx",
  ]);
  const linked = await f.handoff.attach(f.ref);
  if (linked.status !== "ATTACHED") throw Error("expected good sibling card");
  expect(linked.failures).toEqual([
    { path: "Exports/suite.xlsx", code: "MERCALYS_ZIP_INVALID" },
  ]);
  expect(existsSync(fileURLToPath(f.uri))).toBe(true);
});
