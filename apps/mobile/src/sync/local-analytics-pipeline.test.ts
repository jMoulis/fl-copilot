import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { ApiClientError } from "@fl-copilot/api-client";
import type { SQLiteDatabase } from "expo-sqlite";
import { SyncProvider, useSync, type SyncContextValue } from "./sync-provider";
import { runLocalMigrations } from "../db/migrations";
import { serializeLocalWrites } from "../db/serialized-writes";
import { enqueueAnalyticsRecomputationJob } from "../analytics/local-recomputation";
import { createSyncTestEntity } from "./sync-test-entity";
import { notifyOutboxChanged, type OutboxDatabase } from "./outbox-repository";

const runtime = vi.hoisted(() => ({
  database: undefined as unknown,
  session: undefined as unknown,
  network: vi.fn(),
  token: async (operation: (token: string) => Promise<unknown>) =>
    operation("fixture-token"),
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" } },
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session, withAccessToken: runtime.token }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../config/environment", () => ({
  getApiBaseUrl: () => "https://fixture.invalid",
}));
vi.mock("../observability/sentry", () => ({
  captureLocalOperationFailure: vi.fn(),
}));
vi.mock("./sync-service", () => ({
  MobileSyncService: class {
    sync = runtime.network;
  },
}));
vi.mock("../documents/source-upload-queue", () => ({
  SourceUploadQueue: class {
    async process() {}
  },
}));
vi.mock("../documents/commercial-analysis-recovery", () => ({
  CommercialAnalysisRecoveryQueue: class {
    async process() {}
  },
}));
vi.mock("../documents/source-original-jobs", () => ({
  SourceOriginalJobs: class {
    async process() {}
    interrupt() {}
  },
}));
vi.mock("../documents/source-original-transfer", () => ({
  SourceOriginalTransfer: class {},
}));
vi.mock("../documents/source-original-files", () => ({
  nativeSourceOriginalFiles: {},
}));
vi.mock("../products/visual-file-jobs", () => ({
  VisualFileJobs: class {
    async process() {}
  },
}));
vi.mock("../products/visual-file-transfer", () => ({
  VisualFileTransfer: class {},
}));
vi.mock("../products/visual-file-storage", () => ({
  nativeVisualFileStorage: {},
}));
vi.mock("../products/visual-file-cache", () => ({
  VisualFileCache: class {
    async clean() {}
  },
}));
vi.mock("../intake/email-intake-cache", () => ({ EmailIntakeCache: class {} }));
vi.mock("../intake/email-decision-repository", () => ({
  EmailDecisionRepository: class {},
}));
vi.mock("../intake/email-intake-processing", () => ({
  EmailIntakeProcessing: class {
    async seed() {}
  },
  emailProcessingFormat: vi.fn(),
}));
vi.mock("../intake/email-mercalys-handoff", () => ({
  EmailMercalysHandoff: class {},
}));
vi.mock("../intake/email-source-handoff", () => ({
  EmailSourceHandoff: class {},
}));
vi.mock("../intake/email-original-transfer", () => ({
  EmailOriginalTransfer: class {},
}));
vi.mock("../intake/email-original-files", () => ({
  nativeEmailOriginalFiles: {},
  readNativeEmailProcessingBytes: vi.fn(),
}));
vi.mock("../copilot/mercalys-import-controller", () => ({
  CopilotMercalysImportController: class {},
}));

type Value = string | number | null;
class FileDatabase {
  constructor(
    readonly raw: DatabaseSync,
    readonly path: string,
  ) {}
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async runAsync(sql: string, ...args: Value[]) {
    return this.raw.prepare(sql).run(...args);
  }
  async getFirstAsync<T>(sql: string, ...args: Value[]) {
    return (this.raw.prepare(sql).get(...args) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...args: Value[]) {
    return this.raw.prepare(sql).all(...args) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: OutboxDatabase) => Promise<void>,
  ) {
    const raw = new DatabaseSync(this.path);
    try {
      raw.exec("BEGIN IMMEDIATE");
      await task(new FileDatabase(raw, this.path));
      raw.exec("COMMIT");
    } catch (error) {
      if (raw.isTransaction) raw.exec("ROLLBACK");
      throw error;
    } finally {
      raw.close();
    }
  }
}

it.each([
  ["NETWORK_UNAVAILABLE", "offline"],
  ["SYNC_REQUEST_TIMEOUT", "error"],
] as const)(
  "the actual provider drains local work independently of a blocked network and retains the command after %s",
  async (failureCode, failureStatus) => {
    const directory = mkdtempSync(join(tmpdir(), "fl-local-first-")),
      path = join(directory, "local.db"),
      raw = new DatabaseSync(path);
    const db = serializeLocalWrites(
      new FileDatabase(raw, path) as unknown as SQLiteDatabase,
    );
    const store = randomUUID(),
      owner = randomUUID(),
      device = randomUUID();
    let reject!: (error: unknown) => void;
    runtime.network.mockReset().mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    let latest: SyncContextValue | undefined;
    function Probe() {
      latest = useSync();
      return null;
    }
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const originalError = console.error;
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      if (!String(args[0]).includes("react-test-renderer is deprecated")) {
        errors.push(args);
        originalError(...args);
      }
    });
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await runLocalMigrations(db);
      raw
        .prepare(
          "INSERT INTO products(id,store_id,label,category,nature,sales_unit,status,version,created_at,updated_at,sync_state,dirty) VALUES(?,?,'Tomate','VEGETABLE','BULK','KG','ACTIVE',1,?,?, 'SYNCED',0)",
        )
        .run("p", store, "2026-10-23T00:00:00Z", "2026-10-23T00:00:00Z");
      for (let i = 0; i < 17; i++)
        await enqueueAnalyticsRecomputationJob(db, {
          jobId: `job-${i}`,
          storeId: store,
          scopes: [{ productId: "p", businessDate: "2026-10-22" }],
          createdAt: "2026-10-23T00:00:00Z",
        });
      const command = randomUUID();
      await createSyncTestEntity(db, {
        id: randomUUID(),
        commandId: command,
        storeId: store,
        deviceId: device,
        label: "Retained offline",
      });
      const before = raw
        .prepare("SELECT * FROM sync_outbox WHERE command_id=?")
        .get(command);
      runtime.database = { sqlite: db, deviceId: device };
      runtime.session = {
        user: { id: owner },
        stores: [{ storeId: store, role: "MANAGER" }],
      };
      await act(async () => {
        renderer = create(
          createElement(SyncProvider, null, createElement(Probe)),
        );
      });
      await act(async () => {
        await vi.waitFor(() =>
          expect(runtime.network).toHaveBeenCalledTimes(1),
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(
        raw
          .prepare("SELECT COUNT(*) n FROM local_jobs WHERE status='COMPLETED'")
          .get(),
      ).toEqual({ n: 17 });
      expect(
        raw.prepare("SELECT COUNT(*) n FROM product_daily_performance").get(),
      ).toEqual({ n: 1 });
      expect(latest?.pendingCount).toBe(1);
      expect(latest?.pendingCommandCount).toBe(1);
      expect(
        raw
          .prepare("SELECT * FROM sync_outbox WHERE command_id=?")
          .get(command),
      ).toEqual(before);
      // Accepted work arriving during the blocked network exchange also advances.
      await act(async () => {
        await enqueueAnalyticsRecomputationJob(db, {
          jobId: "during-network",
          storeId: store,
          scopes: [{ productId: "p", businessDate: "2026-10-21" }],
          createdAt: "2026-10-23T00:00:01Z",
        });
        notifyOutboxChanged();
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      await act(async () => {
        await vi.waitFor(() =>
          expect(
            raw
              .prepare(
                "SELECT status FROM local_jobs WHERE id='during-network'",
              )
              .get(),
          ).toEqual({ status: "COMPLETED" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(runtime.network).toHaveBeenCalledTimes(1);
      expect(latest?.pendingCount).toBe(1);
      expect(latest?.pendingCommandCount).toBe(1);
      expect(
        raw.prepare("SELECT COUNT(*) n FROM product_daily_performance").get(),
      ).toEqual({ n: 2 });
      await act(async () => {
        const finishing = latest!.syncNow();
        reject(
          new ApiClientError(0, {
            code: failureCode,
            messageFr: "Hors connexion",
            retryable: true,
          }),
        );
        await finishing;
      });
      expect(latest?.status).toBe(failureStatus);
      expect(latest?.pendingCount).toBe(1);
      expect(latest?.pendingCommandCount).toBe(1);
      expect(
        raw
          .prepare("SELECT * FROM sync_outbox WHERE command_id=?")
          .get(command),
      ).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await act(async () => {
        reject?.(
          new ApiClientError(0, {
            code: "NETWORK_UNAVAILABLE",
            messageFr: "Hors connexion",
            retryable: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
        renderer?.unmount();
      });
      spy.mockRestore();
      raw.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
