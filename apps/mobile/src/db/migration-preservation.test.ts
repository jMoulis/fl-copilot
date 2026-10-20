import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { productSchema } from "@fl-copilot/domain";
import { ProductMasterRepository } from "../products/product-master-repository";
import { OutboxRepository } from "../sync/outbox-repository";
import { ReceiptTestDatabase } from "../../../../scripts/test-receipt-publication-sqlite";
import { getOrCreateDeviceId } from "./device-identity";
import {
  getLocalSchemaVersion,
  localMigrations,
  runLocalMigrations,
} from "./migrations";
const at = "2026-10-20T18:00:00.000Z";
const statuses = [
  "PENDING",
  "SYNCING",
  "CONFLICT",
  "FAILED",
  "ACKNOWLEDGED",
] as const;
async function fixture(version: number) {
  const directory = await mkdtemp(join(tmpdir(), "fl-upgrade-matrix-")),
    path = join(directory, "local.sqlite"),
    original = join(directory, "unsent-original.bin"),
    bytes = Buffer.concat([
      Buffer.from("Opaque original retained even before parsing\n"),
      Buffer.from([0, 1, 2]),
    ]),
    checksum = "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    storeId = randomUUID(),
    otherStoreId = randomUUID(),
    deviceId = randomUUID();
  await writeFile(original, bytes);
  const db = new DatabaseSync(path),
    adapter = new ReceiptTestDatabase(db);
  try {
    await runLocalMigrations(adapter, localMigrations.slice(0, version));
    await getOrCreateDeviceId(adapter, () => deviceId);
    const commands = statuses.map((status, index) => ({
      commandId: randomUUID(),
      entityId: randomUUID(),
      status,
      localSequence: index + 1,
    }));
    for (const c of commands) {
      const payload = JSON.stringify({
        id: c.entityId,
        storeId,
        label: "Capture conservée — 00042",
        remoteVersion: 0,
        createdAt: at,
        updatedAt: at,
      });
      if (version === 1)
        db.prepare(
          "INSERT INTO sync_outbox(id,store_id,device_id,entity_type,entity_id,operation,payload_json,base_version,local_sequence,status,attempt_count,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          c.commandId,
          storeId,
          deviceId,
          "sync_test_entity",
          c.entityId,
          "SYNC_TEST_ENTITY_UPSERT",
          payload,
          null,
          c.localSequence,
          c.status.toLowerCase(),
          2,
          "NETWORK_ERROR",
          at,
          at,
        );
      else
        db.prepare(
          "INSERT INTO sync_outbox(command_id,store_id,device_id,entity_type,entity_id,command_type,payload_json,expected_remote_version,local_sequence,status,attempt_count,last_error_code,created_at,last_attempt_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          c.commandId,
          storeId,
          deviceId,
          "sync_test_entity",
          c.entityId,
          "SYNC_TEST_ENTITY_UPSERT",
          payload,
          null,
          c.localSequence,
          c.status,
          2,
          "NETWORK_ERROR",
          at,
          at,
        );
    }
    if (version >= 2)
      db.prepare(
        "INSERT INTO app_metadata(key,value,updated_at) VALUES('outbox_local_sequence','900',?) ON CONFLICT(key) DO UPDATE SET value='900'",
      ).run(at);
    const fileId = randomUUID(),
      uri = pathToFileURL(original).href;
    db.prepare(
      "INSERT INTO local_files(id,store_id,local_uri,mime_type,size_bytes,checksum,retention_status,upload_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      fileId,
      storeId,
      uri,
      "application/octet-stream",
      bytes.length,
      checksum,
      "REQUIRED",
      "PENDING",
      at,
      at,
    );
    const jobId = randomUUID(),
      jobPayload = JSON.stringify({
        storeId,
        fileId,
        checksum,
        sourceDocumentId: null,
      });
    db.prepare(
      "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,next_attempt_at,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      jobId,
      "SOURCE_UPLOAD_AND_REGISTER",
      jobPayload,
      "PENDING",
      3,
      "2026-10-21T18:00:00.000Z",
      "NETWORK_ERROR",
      at,
      at,
    );
    const local = JSON.stringify({ label: "Version locale", code: "00042" }),
      remote = JSON.stringify({ label: "Version distante", code: "00043" }),
      conflictId = randomUUID();
    if (version < 5)
      db.prepare(
        "INSERT INTO sync_conflicts(id,store_id,entity_type,entity_id,local_payload_json,remote_payload_json,status,detected_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        conflictId,
        storeId,
        "sync_test_entity",
        commands[2]!.entityId,
        local,
        remote,
        "open",
        at,
      );
    else
      db.prepare(
        "INSERT INTO sync_conflicts(id,store_id,command_id,entity_type,entity_id,local_payload_json,remote_payload_json,local_expected_version,remote_version,conflict_type,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        conflictId,
        storeId,
        commands[2]!.commandId,
        "sync_test_entity",
        commands[2]!.entityId,
        local,
        remote,
        0,
        1,
        "SYNC_VERSION_CONFLICT",
        "OPEN",
        at,
      );
    if (version < 4)
      db.prepare(
        "INSERT INTO sync_inbox_state(store_id,last_server_sequence,last_sync_at,updated_at) VALUES(?,?,?,?)",
      ).run(storeId, 73, at, at);
    else
      db.prepare(
        "INSERT INTO sync_inbox_state(store_id,cursor,last_successful_sync_at,protocol_version,bootstrap_revision) VALUES(?,?,?,?,?)",
      ).run(storeId, "opaque-cursor-kept", at, 1, "bootstrap-kept");
    if (version >= 6) {
      const product = productSchema.parse({
        id: randomUUID(),
        storeId,
        label: "FIGUE VRAC",
        category: "FRUIT",
        nature: "BULK",
        salesUnit: "KG",
        packaging: null,
        familyId: null,
        subfamilyId: null,
        status: "ACTIVE",
        version: 2,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      });
      await new ProductMasterRepository(adapter).upsertProduct(product, {
        commandId: randomUUID(),
        deviceId,
        expectedRemoteVersion: 1,
      });
    }
    // Keep a second-store row to ensure interruption recovery stays scoped.
    if (version >= 2)
      db.prepare(
        "INSERT INTO sync_outbox(command_id,store_id,device_id,entity_type,entity_id,command_type,payload_json,local_sequence,status,attempt_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        otherStoreId,
        randomUUID(),
        "sync_test_entity",
        randomUUID(),
        "SYNC_TEST_ENTITY_UPSERT",
        "{}",
        1,
        "SYNCING",
        1,
        at,
      );
    return {
      directory,
      path,
      db,
      adapter,
      original,
      bytes,
      checksum,
      storeId,
      otherStoreId,
      deviceId,
      commands,
      version,
    };
  } catch (e) {
    db.close();
    await rm(directory, { recursive: true, force: true });
    throw e;
  }
}
function durableSnapshot(db: DatabaseSync) {
  const names = [
    "sync_outbox",
    "sync_conflicts",
    "local_jobs",
    "local_files",
    "sync_inbox_state",
    "products",
    "product_identifiers",
    "product_aliases",
  ];
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  return Object.fromEntries(
    names
      .filter((n) => tables.includes(n))
      .map((n) => [n, db.prepare(`SELECT * FROM ${n} ORDER BY 1`).all()]),
  );
}
async function verifyUpgrade(
  s: Awaited<ReturnType<typeof fixture>>,
  db: DatabaseSync,
) {
  const adapter = new ReceiptTestDatabase(db),
    beforeFiles = db.prepare("SELECT * FROM local_files ORDER BY id").all(),
    beforeJobs = db.prepare("SELECT * FROM local_jobs ORDER BY id").all(),
    beforeProducts =
      s.version >= 6
        ? db.prepare("SELECT * FROM products ORDER BY id").all()
        : [],
    originalCommands =
      s.version === 1
        ? db
            .prepare(
              "SELECT id command_id,store_id,device_id,local_sequence,operation command_type,entity_type,entity_id,base_version expected_remote_version,payload_json,created_at,UPPER(status) status,attempt_count,updated_at last_attempt_at,last_error last_error_code FROM sync_outbox ORDER BY local_sequence",
            )
            .all()
        : db
            .prepare(
              "SELECT * FROM sync_outbox ORDER BY local_sequence,command_id",
            )
            .all();
  await runLocalMigrations(adapter);
  expect(await getLocalSchemaVersion(adapter)).toBe(localMigrations.length);
  const after = db
    .prepare("SELECT * FROM sync_outbox ORDER BY local_sequence,command_id")
    .all();
  expect(after).toHaveLength(originalCommands.length);
  for (const row of originalCommands)
    expect(after.find((r) => r.command_id === row.command_id)).toEqual(row);
  expect(db.prepare("SELECT * FROM local_files ORDER BY id").all()).toEqual(
    beforeFiles,
  );
  expect(db.prepare("SELECT * FROM local_jobs ORDER BY id").all()).toEqual(
    beforeJobs,
  );
  if (s.version >= 6)
    expect(db.prepare("SELECT * FROM products ORDER BY id").all()).toEqual(
      beforeProducts,
    );
  expect(
    await getOrCreateDeviceId(adapter, () => {
      throw Error("A migration must not replace the device identity");
    }),
  ).toBe(s.deviceId);
  expect(await readFile(s.original)).toEqual(s.bytes);
  const conflict = db
    .prepare("SELECT * FROM sync_conflicts WHERE store_id=?")
    .get(s.storeId)!;
  expect(conflict).toMatchObject({
    status: "OPEN",
    local_payload_json: JSON.stringify({
      label: "Version locale",
      code: "00042",
    }),
    remote_payload_json: JSON.stringify({
      label: "Version distante",
      code: "00043",
    }),
  });
  const inbox = db
    .prepare("SELECT * FROM sync_inbox_state WHERE store_id=?")
    .get(s.storeId)!;
  expect(inbox).toMatchObject({
    last_successful_sync_at: at,
    protocol_version: 1,
    cursor: s.version < 4 ? null : "opaque-cursor-kept",
    bootstrap_revision: s.version < 4 ? null : "bootstrap-kept",
  });
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
    integrity_check: "ok",
  });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  // Startup recovery reuses the same in-flight UUID/payload; other stores stay untouched.
  const repo = new OutboxRepository(adapter),
    inFlight = await repo.getById(s.commands[1]!.commandId);
  expect(await repo.recoverInterrupted(s.storeId)).toBe(1);
  expect(await repo.getById(s.commands[1]!.commandId)).toEqual({
    ...inFlight,
    status: "PENDING",
    lastErrorCode: "SYNC_INTERRUPTED",
  });
  if (s.version >= 2)
    expect(
      db
        .prepare("SELECT status FROM sync_outbox WHERE store_id=?")
        .get(s.otherStoreId),
    ).toEqual({ status: "SYNCING" });
  const highWater = Number(
    db
      .prepare(
        "SELECT value FROM app_metadata WHERE key='outbox_local_sequence'",
      )
      .get()!.value,
  );
  const newId = randomUUID();
  const queued = await repo.enqueue({
    commandId: newId,
    deviceId: s.deviceId,
    storeId: s.storeId,
    entityId: randomUUID(),
    entityType: "sync_test_entity",
    commandType: "SYNC_TEST_ENTITY_UPSERT",
    payload: { unchanged: true },
    createdAt: at,
  });
  expect(queued.localSequence).toBe(highWater + 1);
  expect(queued.localSequence).toBeGreaterThan(
    Math.max(
      ...after
        .filter((r) => r.device_id === s.deviceId)
        .map((r) => Number(r.local_sequence)),
    ),
  );
  const stable = durableSnapshot(db);
  await runLocalMigrations(adapter);
  expect(durableSnapshot(db)).toEqual(stable);
  expect(await readFile(s.original)).toEqual(s.bytes);
}
it.each(localMigrations.map((m) => m.version))(
  "preserves queued work, originals and identity upgrading schema v%s through the real migration runner and reopen",
  async (version) => {
    const s = await fixture(version);
    s.db.close();
    const db = new DatabaseSync(s.path);
    try {
      await verifyUpgrade(s, db);
    } finally {
      db.close();
      await rm(s.directory, { recursive: true, force: true });
    }
  },
);
it.each(localMigrations.slice(0, -1).map((m) => m.version))(
  "rolls back an interrupted first migration after v%s, then resumes without losing work",
  async (version) => {
    const s = await fixture(version);
    let closed = false;
    try {
      const before = durableSnapshot(s.db),
        schema = s.db
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
          )
          .all();
      const failing = {
        execAsync: async (sql: string) => {
          if (sql.trim() === "COMMIT;")
            throw Error("INTERRUPTED_BEFORE_COMMIT");
          await s.adapter.execAsync(sql);
        },
        getFirstAsync: s.adapter.getFirstAsync.bind(s.adapter),
      };
      await expect(runLocalMigrations(failing)).rejects.toThrow(
        "INTERRUPTED_BEFORE_COMMIT",
      );
      expect(await getLocalSchemaVersion(s.adapter)).toBe(version);
      expect(durableSnapshot(s.db)).toEqual(before);
      expect(
        s.db
          .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
          )
          .all(),
      ).toEqual(schema);
      s.db.close();
      closed = true;
      const reopened = new DatabaseSync(s.path);
      try {
        await verifyUpgrade(s, reopened);
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) s.db.close();
      await rm(s.directory, { recursive: true, force: true });
    }
  },
);
async function killBeforeCommit(path: string, targetVersion: number) {
  const moduleUrl = new URL("./migrations.ts", import.meta.url).href;
  const script = `import {DatabaseSync} from 'node:sqlite';
 const {runLocalMigrations,localMigrations}=await import(${JSON.stringify(moduleUrl)});
 const db=new DatabaseSync(${JSON.stringify(path)});
 const adapter={execAsync:async(sql)=>{if(sql.trim()==='COMMIT;'){process.stdout.write('READY_TO_KILL\\n');await new Promise(()=>{});}db.exec(sql);},getFirstAsync:async(sql)=>db.prepare(sql).get()??null};
 const keepAlive=setInterval(()=>{},1000);
 await runLocalMigrations(adapter,localMigrations.slice(0,${targetVersion}));clearInterval(keepAlive);throw Error('Unexpected commit');`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostic = "",
    output = "";
  child.stderr.on("data", (data) => {
    diagnostic = (diagnostic + String(data)).slice(-2500);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Migration child did not reach commit: " + diagnostic));
    }, 10000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (data) => {
      output += String(data);
      if (output.includes("READY_TO_KILL")) {
        clearTimeout(timer);
        child.kill("SIGKILL");
      }
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL" && output.includes("READY_TO_KILL")) resolve();
      else
        reject(
          Error("Migration process exited before interruption: " + diagnostic),
        );
    });
  });
}
it.each([1, 3, 4, 12, 38, 58, 59])(
  "recovers WAL after a real SIGKILL before committing the migration after v%s",
  async (version) => {
    const s = await fixture(version),
      before = durableSnapshot(s.db),
      schema = s.db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
        )
        .all();
    s.db.close();
    try {
      await killBeforeCommit(s.path, version + 1);
      const db = new DatabaseSync(s.path);
      try {
        const a = new ReceiptTestDatabase(db);
        expect(await getLocalSchemaVersion(a)).toBe(version);
        expect(durableSnapshot(db)).toEqual(before);
        expect(
          db
            .prepare(
              "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
            )
            .all(),
        ).toEqual(schema);
        await verifyUpgrade(s, db);
      } finally {
        db.close();
      }
    } finally {
      await rm(s.directory, { recursive: true, force: true });
    }
  },
);
