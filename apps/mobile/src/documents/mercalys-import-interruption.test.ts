import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  MercalysExactDuplicateError,
  MercalysImportPublicationRepository,
} from "./mercalys-import-publication";
import { readMercalysPublication } from "./mercalys-publication-sync";

const tables = [
  "app_metadata",
  "products",
  "source_documents",
  "local_files",
  "source_records",
  "sales_observations",
  "waste_observations",
  "sync_outbox",
  "local_jobs",
  "mercalys_publication_sync",
] as const;
function snapshot(db: DatabaseSync) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
    ]),
  );
}
type Boundary = "observation" | "before-commit" | "after-commit";

/** Actual process loss: no thrown exception or graceful adapter rollback. */
async function interrupt(path: string, inputPath: string, boundary: Boundary) {
  const fixtureUrl = new URL(
    "../../../../scripts/test-mercalys-sync-fixtures.ts",
    import.meta.url,
  ).href;
  const repositoryUrl = new URL(
    "./mercalys-import-publication.ts",
    import.meta.url,
  ).href;
  // Node's installed TS transformer needs only extensionless-relative resolution.
  const script = [
    "import { registerHooks } from 'node:module';",
    "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { DatabaseSync } from 'node:sqlite';",
    "import { randomUUID } from 'node:crypto';",
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
    "const { MercalysTestDatabase } = await import(" +
      JSON.stringify(fixtureUrl) +
      ");",
    "const { MercalysImportPublicationRepository } = await import(" +
      JSON.stringify(repositoryUrl) +
      ");",
    "const db = new DatabaseSync(" + JSON.stringify(path) + ");",
    "db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');",
    "const boundary = " + JSON.stringify(boundary) + ";",
    "const keepAlive = setInterval(() => {}, 1000);",
    "async function stop() {",
    " const tables = " + JSON.stringify(tables) + ";",
    " const rows = Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));",
    " writeFileSync(" +
      JSON.stringify(path + ".checkpoint.json") +
      ", JSON.stringify(rows));",
    " process.stdout.write('READY_TO_KILL\\n');",
    " await new Promise(() => {});",
    "}",
    "class InterruptedDatabase extends MercalysTestDatabase {",
    " async runAsync(sql, ...params) {",
    "  const result = await super.runAsync(sql, ...params);",
    "  if (boundary === 'observation' && /INSERT INTO (sales|waste)_observations/.test(sql)) await stop();",
    "  return result;",
    " }",
    " async withExclusiveTransactionAsync(task) {",
    "  db.exec('BEGIN IMMEDIATE');",
    "  await task(this);",
    "  if (boundary === 'before-commit') await stop();",
    "  db.exec('COMMIT');",
    "  if (boundary === 'after-commit') await stop();",
    " }",
    "}",
    "const input = JSON.parse(readFileSync(" +
      JSON.stringify(inputPath) +
      ", 'utf8'));",
    "await new MercalysImportPublicationRepository(new InterruptedDatabase(db), randomUUID, () => '2026-11-05T12:00:00.000Z').publish(input);",
    "clearInterval(keepAlive);",
    "throw Error('Publication unexpectedly returned');",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--experimental-transform-types", "--input-type=module", "-e", script],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    diagnostics = "";
  child.stderr.on("data", (data) => {
    diagnostics = (diagnostics + String(data)).slice(-3000);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        Error("Import did not reach interruption boundary: " + diagnostics),
      );
    }, 20_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (data) => {
      output += String(data);
      if (output.includes("READY_TO_KILL")) child.kill("SIGKILL");
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL" && output.includes("READY_TO_KILL")) resolve();
      else reject(Error("Import exited before interruption: " + diagnostics));
    });
  });
}

const cases = (["MERCALYS_SALES", "MERCALYS_WASTE"] as const).flatMap((flow) =>
  (["observation", "before-commit", "after-commit"] as const).map(
    (boundary) => ({ flow, boundary }),
  ),
);
it.each(cases)(
  "recovers $flow after real SIGKILL at $boundary without partial publication or duplicate retry",
  async ({ flow, boundary }) => {
    const directory = await mkdtemp(join(tmpdir(), "fl-import-kill-")),
      path = join(directory, "phone.db"),
      inputPath = join(directory, "input.json"),
      storeId = randomUUID(),
      productId = randomUUID(),
      observationTable =
        flow === "MERCALYS_SALES" ? "sales_observations" : "waste_observations";
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      const adapter = new MercalysTestDatabase(db);
      await mercalysLocalFixture(adapter, storeId, productId);
      const prior = mercalysWorkbook(
        storeId,
        productId,
        flow,
        "2026-10-06",
        10,
        false,
      );
      prior.input.localFileUri = pathToFileURL(
        join(directory, "prior.xlsx"),
      ).href;
      await writeFile(new URL(prior.input.localFileUri), prior.bytes);
      await new MercalysImportPublicationRepository(
        adapter,
        randomUUID,
      ).publish(prior.input);
      const before = snapshot(db),
        target = mercalysWorkbook(
          storeId,
          productId,
          flow,
          "2026-10-07",
          12.4,
          false,
        );
      target.input.localFileUri = pathToFileURL(
        join(directory, "selected.xlsx"),
      ).href;
      await writeFile(new URL(target.input.localFileUri), target.bytes);
      await writeFile(inputPath, JSON.stringify(target.input));
      db.close();
      db = undefined;
      await interrupt(path, inputPath, boundary);
      const checkpoint = JSON.parse(
        await readFile(path + ".checkpoint.json", "utf8"),
      );
      expect(checkpoint[observationTable]).toHaveLength(2);
      db = new DatabaseSync(path);
      expect(db.prepare("PRAGMA quick_check").get()).toEqual({
        quick_check: "ok",
      });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(snapshot(db)).toEqual(
        boundary === "after-commit" ? checkpoint : before,
      );
      expect(await readFile(new URL(target.input.localFileUri))).toEqual(
        Buffer.from(target.bytes),
      );
      expect(await readFile(new URL(prior.input.localFileUri))).toEqual(
        Buffer.from(prior.bytes),
      );
      const reopened = new MercalysTestDatabase(db),
        publication = new MercalysImportPublicationRepository(
          reopened,
          randomUUID,
        );
      if (boundary !== "after-commit") await publication.publish(target.input);
      const committed = snapshot(db);
      await expect(publication.publish(target.input)).rejects.toBeInstanceOf(
        MercalysExactDuplicateError,
      );
      expect(snapshot(db)).toEqual(committed);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM " + observationTable).get(),
      ).toEqual({ n: 2 });
      expect(committed.source_documents).toHaveLength(2);
      expect(committed.local_files).toHaveLength(2);
      expect(committed.sync_outbox).toHaveLength(2);
      expect(committed.local_jobs).toHaveLength(4);
      const sources = await reopened.getAllAsync<{ id: string }>(
        "SELECT id FROM source_documents ORDER BY rowid",
      );
      for (const source of sources) {
        const aggregate = await readMercalysPublication(
          reopened,
          storeId,
          source.id,
        );
        expect(aggregate?.records).toHaveLength(1);
        expect([
          ...(aggregate?.sales ?? []),
          ...(aggregate?.waste ?? []),
        ]).toHaveLength(1);
      }
      for (const table of tables.filter((name) => name !== "app_metadata"))
        expect(committed[table].slice(0, before[table].length)).toEqual(
          before[table],
        );
    } finally {
      db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
