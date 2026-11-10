import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import {
  MercalysTestDatabase,
  mercalysLocalFixture,
  mercalysWorkbook,
} from "../../../../scripts/test-mercalys-sync-fixtures";
import { MercalysImportPublicationRepository } from "./mercalys-import-publication";

type Boundary =
  "socket-drop" | "kill-during-upload" | "kill-after-confirmation";
const stableTables = [
  "app_metadata",
  "products",
  "source_records",
  "sales_observations",
  "waste_observations",
  "sync_outbox",
  "mercalys_publication_sync",
] as const;
function stableSnapshot(db: DatabaseSync) {
  return Object.fromEntries(
    stableTables.map((table) => [
      table,
      db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
    ]),
  );
}

/** Runs the actual queue/API client in another process; only native file I/O and
 * the remote service are test ports. IPC selects a deterministic TCP boundary. */
async function runQueue(
  path: string,
  storeId: string,
  baseUrl: string,
  retry: boolean,
  killed: boolean,
  started: (child: ChildProcess) => void,
) {
  const fixtureUrl = new URL(
    "../../../../scripts/test-mercalys-sync-fixtures.ts",
    import.meta.url,
  ).href;
  const queueUrl = new URL("./source-upload-queue.ts", import.meta.url).href;
  const clientUrl = new URL(
    "../../../../packages/api-client/src/index.ts",
    import.meta.url,
  ).href;
  const script = [
    "import { registerHooks } from 'node:module';",
    "import { existsSync } from 'node:fs';",
    "import { readFile } from 'node:fs/promises';",
    "import { fileURLToPath } from 'node:url';",
    "import { request } from 'node:http';",
    "import { DatabaseSync } from 'node:sqlite';",
    "registerHooks({resolve(specifier, context, next) {",
    " try { return next(specifier, context); } catch (error) {",
    "  if (!specifier.startsWith('.')) throw error;",
    "  const base = new URL(specifier, context.parentURL);",
    "  for (const suffix of ['.ts', '/index.ts']) {",
    "   const candidate = new URL(base.href + suffix);",
    "   if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);",
    "  } throw error;",
    " }",
    "}});",
    `const { MercalysTestDatabase } = await import(${JSON.stringify(fixtureUrl)});`,
    `const { SourceUploadQueue } = await import(${JSON.stringify(queueUrl)});`,
    `const { ApiClient } = await import(${JSON.stringify(clientUrl)});`,
    `const db = new DatabaseSync(${JSON.stringify(path)});`,
    "db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');",
    `const api = new ApiClient(${JSON.stringify(baseUrl)});`,
    "const transport = {",
    " init: (store, input) => api.initSourceUpload('test-session', store, input),",
    " complete: (store, id, input) => api.completeSourceUpload('test-session', store, id, input),",
    " verify: (store, id, input) => api.verifyImport('test-session', store, id, input),",
    "};",
    "const uploader = { async upload(input) {",
    " const bytes = await readFile(new URL(input.localUri));",
    " await new Promise((resolve, reject) => {",
    "  const req = request(input.uploadUrl, {method:'PUT', headers:{...input.headers, 'content-length':String(bytes.length)}}, res => {",
    "   res.resume(); res.on('end', () => res.statusCode === 200 ? resolve() : reject(Error('UPLOAD_HTTP_FAILURE')));",
    "  });",
    "  req.on('error', reject);",
    "  process.once('message', () => req.end(bytes.subarray(1024)));",
    "  req.write(bytes.subarray(0,1024));",
    " });",
    "}};",
    `const queue = new SourceUploadQueue(new MercalysTestDatabase(db), transport, uploader, () => new Date(${JSON.stringify(retry ? "2026-11-10T12:01:00.000Z" : "2026-11-10T12:00:00.000Z")}));`,
    `const result = await queue.process(${JSON.stringify(storeId)});`,
    "db.close(); process.stdout.write('RESULT:'+JSON.stringify(result)+'\\n'); process.disconnect();",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--experimental-transform-types", "--input-type=module", "-e", script],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  started(child);
  let output = "",
    diagnostics = "";
  child.stdout!.on("data", (data) => {
    output += String(data);
  });
  child.stderr!.on("data", (data) => {
    diagnostics = (diagnostics + String(data)).slice(-3000);
  });
  return new Promise<{ attempted: number; confirmed: number } | null>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("Transfer did not finish: " + diagnostics));
      }, 20_000);
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (killed && signal === "SIGKILL") return resolve(null);
        const result = /RESULT:(\{[^\n]+\})/.exec(output)?.[1];
        if (!killed && code === 0 && result) return resolve(JSON.parse(result));
        reject(Error("Unexpected transfer exit: " + diagnostics + output));
      });
    },
  );
}

it.each<Boundary>([
  "socket-drop",
  "kill-during-upload",
  "kill-after-confirmation",
])(
  "reopens and retries the same retained upload after real %s",
  async (boundary) => {
    const directory = await mkdtemp(join(tmpdir(), "fl-upload-interruption-"));
    const path = join(directory, "phone.db"),
      original = join(directory, "original.xlsx");
    const storeId = randomUUID(),
      productId = randomUUID(),
      uploadId = randomUUID();
    let db: DatabaseSync | undefined, activeChild: ChildProcess | undefined;
    let injected = false,
      retry = false,
      initCalls = 0,
      uploadAttempts = 0,
      acceptedUploads = 0,
      completeCalls = 0,
      confirmationCommits = 0,
      verificationCalls = 0;
    let uploaded = false,
      confirmed = false,
      firstChunkBytes = 0;
    const unexpected: unknown[] = [];
    const server = createServer();
    try {
      db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      const adapter = new MercalysTestDatabase(db);
      await mercalysLocalFixture(adapter, storeId, productId);
      const workbook = mercalysWorkbook(
        storeId,
        productId,
        "MERCALYS_SALES",
        "2026-11-09",
        12.4,
        false,
      );
      workbook.input.localFileUri = pathToFileURL(original).href;
      expect(workbook.bytes.length).toBeGreaterThan(1024);
      await writeFile(original, workbook.bytes);
      const publication = await new MercalysImportPublicationRepository(
        adapter,
        randomUUID,
      ).publish(workbook.input);
      const sourceId = publication.sourceDocumentId;
      const before = stableSnapshot(db);
      const uploadJob = db
        .prepare(
          "SELECT * FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
        )
        .get()!;
      const otherJobs = db
        .prepare(
          "SELECT * FROM local_jobs WHERE type!='SOURCE_UPLOAD_AND_REGISTER' ORDER BY id",
        )
        .all();
      const files = db
        .prepare(
          "SELECT id,source_document_id,local_uri,checksum,size_bytes,retention_status FROM local_files ORDER BY id",
        )
        .all();
      const sources = db
        .prepare(
          "SELECT id,checksum,local_file_uri FROM source_documents ORDER BY id",
        )
        .all();
      db.close();
      db = undefined;
      let baseUrl = "";
      server.on("request", (req, res) => {
        void (async () => {
          if (req.url === "/binary" && req.method === "PUT") {
            uploadAttempts++;
            const chunks: Buffer[] = [];
            let first = true,
              receivedBytes = 0;
            req.on("error", () => {
              /* Expected when the client or socket is killed. */
            });
            for await (const data of req) {
              chunks.push(Buffer.from(data));
              receivedBytes += Buffer.byteLength(data);
              // TCP may split a write across reads. Await the complete checkpoint.
              if (first && receivedBytes >= 1024) {
                first = false;
                if (!retry && boundary !== "kill-after-confirmation") {
                  injected = true;
                  firstChunkBytes = receivedBytes;
                  if (boundary === "socket-drop") req.socket.destroy();
                  else activeChild!.kill("SIGKILL");
                  return;
                }
                activeChild!.send("CONTINUE_UPLOAD");
              }
            }
            const bytes = Buffer.concat(chunks);
            expect(bytes.length).toBe(workbook.input.sizeBytes);
            expect(
              `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            ).toBe(workbook.input.checksum);
            expect(bytes.equals(Buffer.from(workbook.bytes))).toBe(true);
            await writeFile(join(directory, "remote-binary.xlsx"), bytes);
            uploaded = true;
            acceptedUploads++;
            res.writeHead(200);
            res.end();
            return;
          }
          expect(req.headers.authorization).toBe("Bearer test-session");
          expect(req.headers["x-store-id"]).toBe(storeId);
          const body: Buffer[] = [];
          for await (const data of req) body.push(Buffer.from(data));
          const input = JSON.parse(Buffer.concat(body).toString());
          let result: unknown;
          if (req.url === "/api/v1/uploads/init") {
            initCalls++;
            expect(input).toMatchObject({
              sourceDocumentId: sourceId,
              checksum: workbook.input.checksum,
              sizeBytes: workbook.input.sizeBytes,
            });
            result = {
              uploadId,
              objectKey: `sources/${storeId}/${sourceId}/original.xlsx`,
              status: uploaded ? "ALREADY_UPLOADED" : "UPLOAD_REQUIRED",
              uploadUrl: uploaded ? null : baseUrl + "/binary",
              expiresAt: uploaded ? null : "2030-01-01T00:00:00.000Z",
              headers: { "content-type": workbook.input.mimeType },
            };
          } else if (req.url === `/api/v1/uploads/${uploadId}/complete`) {
            completeCalls++;
            expect(uploaded).toBe(true);
            expect(input).toEqual({
              checksum: workbook.input.checksum,
              sizeBytes: workbook.input.sizeBytes,
            });
            if (!confirmed) {
              confirmed = true;
              confirmationCommits++;
              await writeFile(
                join(directory, "remote-confirmation.json"),
                JSON.stringify({
                  sourceId,
                  uploadId,
                  checksum: workbook.input.checksum,
                  sizeBytes: workbook.input.sizeBytes,
                }),
              );
            }
            if (!retry && boundary === "kill-after-confirmation") {
              injected = true;
              activeChild!.kill("SIGKILL");
              return;
            }
            result = {
              sourceDocumentId: sourceId,
              remoteUploadStatus: "CONFIRMED",
              jobId: null,
            };
          } else if (req.url === `/api/v1/imports/${sourceId}/verify`) {
            verificationCalls++;
            expect(confirmed).toBe(true);
            expect(input).toMatchObject({
              sourceType: "MERCALYS_SALES",
              checksum: workbook.input.checksum,
              localRecordCount: 1,
            });
            result = {
              sourceDocumentId: sourceId,
              status: "MATCH",
              localFingerprint: input.localNormalizedFingerprint,
              remoteFingerprint: input.localNormalizedFingerprint,
            };
          } else throw Error("Unexpected loopback endpoint");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        })().catch((error) => {
          unexpected.push(error);
          res.destroy();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw Error("Missing loopback address");
      baseUrl = `http://127.0.0.1:${address.port}`;
      const result = await runQueue(
        path,
        storeId,
        baseUrl,
        false,
        boundary !== "socket-drop",
        (child) => {
          activeChild = child;
        },
      );
      expect(injected).toBe(true);
      if (boundary === "socket-drop")
        expect(result).toEqual({ attempted: 1, confirmed: 0 });
      else expect(result).toBeNull();
      if (boundary !== "kill-after-confirmation") {
        expect(firstChunkBytes).toBe(1024);
        expect(firstChunkBytes).toBeLessThan(workbook.bytes.length);
        expect(uploaded).toBe(false);
        expect(completeCalls).toBe(0);
      } else {
        expect(
          JSON.parse(
            await readFile(join(directory, "remote-confirmation.json"), "utf8"),
          ),
        ).toMatchObject({ sourceId, uploadId });
      }
      db = new DatabaseSync(path);
      expect(stableSnapshot(db)).toEqual(before);
      const interruptedJob = db
        .prepare("SELECT * FROM local_jobs WHERE id=?")
        .get(uploadJob.id!)!;
      expect(interruptedJob).toMatchObject({
        id: uploadJob.id,
        payload_json: uploadJob.payload_json,
        status: boundary === "socket-drop" ? "RETRY" : "RUNNING",
        attempt_count: 1,
      });
      expect(
        db
          .prepare("SELECT upload_status,retention_status FROM local_files")
          .get(),
      ).toEqual({
        upload_status: boundary === "socket-drop" ? "PENDING" : "UPLOADING",
        retention_status: "RETAINED",
      });
      expect(await readFile(original)).toEqual(Buffer.from(workbook.bytes));
      db.close();
      db = undefined;
      retry = true;
      await expect(
        runQueue(path, storeId, baseUrl, true, false, (child) => {
          activeChild = child;
        }),
      ).resolves.toEqual({ attempted: 1, confirmed: 1 });
      await expect(
        runQueue(path, storeId, baseUrl, true, false, (child) => {
          activeChild = child;
        }),
      ).resolves.toEqual({ attempted: 0, confirmed: 0 });
      db = new DatabaseSync(path);
      expect(db.prepare("PRAGMA quick_check").get()).toEqual({
        quick_check: "ok",
      });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(stableSnapshot(db)).toEqual(before);
      expect(
        db
          .prepare(
            "SELECT * FROM local_jobs WHERE type!='SOURCE_UPLOAD_AND_REGISTER' ORDER BY id",
          )
          .all(),
      ).toEqual(otherJobs);
      expect(
        db
          .prepare(
            "SELECT id,source_document_id,local_uri,checksum,size_bytes,retention_status FROM local_files ORDER BY id",
          )
          .all(),
      ).toEqual(files);
      expect(
        db
          .prepare(
            "SELECT id,checksum,local_file_uri FROM source_documents ORDER BY id",
          )
          .all(),
      ).toEqual(sources);
      expect(
        db
          .prepare("SELECT status,attempt_count FROM local_jobs WHERE id=?")
          .get(uploadJob.id!),
      ).toEqual({ status: "COMPLETED", attempt_count: 2 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM local_jobs WHERE type='SOURCE_UPLOAD_AND_REGISTER'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(
        db
          .prepare("SELECT upload_status,retention_status FROM local_files")
          .get(),
      ).toEqual({ upload_status: "CONFIRMED", retention_status: "RETAINED" });
      expect(
        db
          .prepare(
            "SELECT remote_upload_status,remote_processing_status FROM source_documents",
          )
          .get(),
      ).toEqual({
        remote_upload_status: "CONFIRMED",
        remote_processing_status: "VALIDATED",
      });
      expect(await readFile(original)).toEqual(Buffer.from(workbook.bytes));
      expect(await readFile(join(directory, "remote-binary.xlsx"))).toEqual(
        Buffer.from(workbook.bytes),
      );
      expect({
        initCalls,
        uploadAttempts,
        acceptedUploads,
        completeCalls,
        confirmationCommits,
        verificationCalls,
      }).toEqual({
        initCalls: 2,
        uploadAttempts: boundary === "kill-after-confirmation" ? 1 : 2,
        acceptedUploads: 1,
        completeCalls: boundary === "kill-after-confirmation" ? 2 : 1,
        confirmationCommits: 1,
        verificationCalls: 1,
      });
      expect(unexpected).toEqual([]);
    } finally {
      activeChild?.kill("SIGKILL");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
