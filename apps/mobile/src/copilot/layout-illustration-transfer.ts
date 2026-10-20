import { readStoreLayoutScenarioCard } from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import type { CopilotMessage } from "@fl-copilot/domain";
import {
  readLayoutIllustrationManifest,
  layoutIllustrationFileStateSchema,
  type LayoutIllustrationManifest,
  type LayoutIllustrationFileVariant,
} from "@fl-copilot/sync-contracts";
import { sourceOriginalHash } from "../documents/source-original-hash";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { LayoutIllustrationRepository } from "./layout-illustration-repository";
import {
  checkedIllustrationManifest,
  reserveIllustrationCache,
  withIllustrationCache,
  LAYOUT_ILLUSTRATION_CACHE_BYTES,
  type LayoutIllustrationCacheFiles,
} from "./layout-illustration-cache";
export interface LayoutIllustrationFilePort extends LayoutIllustrationCacheFiles {
  existing(
    manifest: LayoutIllustrationManifest,
    variant: LayoutIllustrationFileVariant,
  ): Promise<string | null>;
  write(
    manifest: LayoutIllustrationManifest,
    variant: LayoutIllustrationFileVariant,
    bytes: Uint8Array,
    check: () => void,
  ): Promise<string>;
}
export type LayoutIllustrationView = {
  manifest: LayoutIllustrationManifest;
  sourceUri: string | null;
  imageUri: string | null;
  originalUri: string | null;
  offlineRequired: boolean;
};
export interface LayoutIllustrationFileTransport {
  manifest(storeId: string, preparationId: string): Promise<unknown>;
  download(
    storeId: string,
    manifest: LayoutIllustrationManifest,
    variant: LayoutIllustrationFileVariant,
  ): Promise<Uint8Array>;
}
/** Derived private file cache only. It cannot prepare, generate, adopt, publish or enqueue a provider job. */
export class LayoutIllustrationTransfer {
  private flights = new Map<string, Promise<LayoutIllustrationView | null>>();
  private displayed = new Map<string, string>();
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private repository: Pick<LayoutIllustrationRepository, "find">,
    private api: LayoutIllustrationFileTransport,
    private files: LayoutIllustrationFilePort,
    private session: () => { storeId: string; userId: string } | null,
    private policy: { budgetBytes?: number; now?: () => string } = {},
  ) {}
  private scope(message: CopilotMessage) {
    const s = this.session();
    if (!s || s.storeId !== message.storeId || s.userId !== message.ownerId)
      throw Error("LAYOUT_ILLUSTRATION_SCOPE_CHANGED");
    return { ...s };
  }
  private check(scope: { storeId: string; userId: string }) {
    const s = this.session();
    if (!s || s.storeId !== scope.storeId || s.userId !== scope.userId)
      throw Error("LAYOUT_ILLUSTRATION_SCOPE_CHANGED");
  }
  private async bound(message: CopilotMessage, raw: unknown) {
    const record = await this.repository.find(message);
    if (!record) throw Error("LAYOUT_ILLUSTRATION_SOURCE_UNAVAILABLE");
    const m = checkedIllustrationManifest(
      readLayoutIllustrationManifest(raw, record.entity),
    );
    return m;
  }
  private async view(
    message: CopilotMessage,
    manifest: LayoutIllustrationManifest,
  ) {
    const row = await this.db.getFirstAsync<{ offline_required: number }>(
      "SELECT MAX(offline_required) offline_required FROM copilot_layout_illustration_files WHERE preparation_id=? AND store_id=? AND owner_id=?",
      manifest.preparation.id,
      manifest.preparation.storeId,
      manifest.preparation.ownerId,
    );
    const view = {
      offlineRequired: !!row?.offline_required,
      manifest,
      sourceUri: await this.files
        .existing(manifest, "source")
        .catch(() => null),
      imageUri: await this.files.existing(manifest, "image").catch(() => null),
      originalUri: await this.files
        .existing(manifest, "original")
        .catch(() => null),
    };
    // Native file reads yield: logical deletion must still win before displaying.
    await this.bound(message, manifest);
    return view;
  }
  async load(message: CopilotMessage) {
    const scope = this.scope(message);
    return withIllustrationCache(scope, () => this.read(message));
  }
  private async read(message: CopilotMessage) {
    const scope = this.scope(message),
      record = await this.repository.find(message);
    this.check(scope);
    if (!record) return null;
    let before: { created_at: string; id: string } | undefined;
    let partial: LayoutIllustrationView | null = null;
    do {
      const rows = await this.db.getAllAsync<{
        id: string;
        created_at: string;
        manifest_json: string;
      }>(
        `SELECT id,created_at,manifest_json FROM copilot_layout_illustration_files WHERE store_id=? AND owner_id=? AND preparation_id=? ${before ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT 20`,
        scope.storeId,
        scope.userId,
        record.entity.id,
        ...(before ? [before.created_at, before.created_at, before.id] : []),
      );
      for (const row of rows) {
        const manifest = await this.bound(
          message,
          JSON.parse(row.manifest_json),
        );
        if (manifest.id !== row.id || manifest.createdAt !== row.created_at)
          throw Error("LAYOUT_ILLUSTRATION_MANIFEST_INVALID");
        const view = await this.view(message, manifest);
        this.check(scope);
        partial ??= view;
        if (view.sourceUri && view.imageUri) {
          await this.db.runAsync(
            "UPDATE copilot_layout_illustration_files SET last_accessed_at=? WHERE id=? AND store_id=? AND owner_id=?",
            this.now(),
            manifest.id,
            scope.storeId,
            scope.userId,
          );
          this.check(scope);
          this.displayed.set(message.id, manifest.id);
          return view;
        }
      }
      if (rows.length < 20) break;
      before = rows.at(-1)!;
    } while (before);
    this.check(scope);
    if (partial) this.displayed.set(message.id, partial.manifest.id);
    return partial;
  }
  private now() {
    return this.policy.now?.() ?? new Date().toISOString();
  }
  async setOfflineRequired(
    message: CopilotMessage,
    resultId: string,
    required: boolean,
  ) {
    const scope = this.scope(message);
    return withIllustrationCache(scope, async () => {
      this.check(scope);
      const row = await this.db.getFirstAsync<{ manifest_json: string }>(
        "SELECT manifest_json FROM copilot_layout_illustration_files WHERE id=? AND store_id=? AND owner_id=?",
        resultId,
        scope.storeId,
        scope.userId,
      );
      if (!row) throw Error("LAYOUT_ILLUSTRATION_SOURCE_UNAVAILABLE");
      const manifest = await this.bound(message, JSON.parse(row.manifest_json));
      if (manifest.id !== resultId)
        throw Error("LAYOUT_ILLUSTRATION_RESULT_IMMUTABLE");
      if (required) {
        const cached = await this.view(message, manifest);
        this.check(scope);
        if (!cached.sourceUri || !cached.imageUri)
          throw Error("LAYOUT_ILLUSTRATION_FILES_MISSING");
      }
      await this.register(message, manifest, scope, required);
      const view = await this.view(message, manifest);
      this.check(scope);
      return view;
    });
  }
  refresh(message: CopilotMessage, original = false) {
    const scope = this.scope(message),
      key = `${scope.storeId}/${scope.userId}/${message.id}/${original}`;
    const pending = this.flights.get(key);
    if (pending) return pending;
    const task = withIllustrationCache(scope, () =>
      this.receive(message, scope, original),
    );
    this.flights.set(key, task);
    void task
      .finally(() => {
        if (this.flights.get(key) === task) this.flights.delete(key);
      })
      .catch(() => undefined);
    return task;
  }
  private async receive(
    message: CopilotMessage,
    scope: { storeId: string; userId: string },
    original: boolean,
  ) {
    const check = () => this.check(scope),
      record = await this.repository.find(message);
    check();
    if (!record || record.syncState !== "SYNCED")
      throw Error("LAYOUT_ILLUSTRATION_PREPARATION_PENDING");
    const reply = layoutIllustrationFileStateSchema.parse(
      await this.api.manifest(scope.storeId, record.entity.id),
    );
    check();
    if (reply.state === "EMPTY") {
      if (reply.preparationId !== record.entity.id)
        throw Error("LAYOUT_ILLUSTRATION_SCOPE_INVALID");
      return null;
    }
    const manifest = await this.bound(message, reply.manifest);
    check();
    const variants = [
      "source",
      "image",
      ...(original ? ["original" as const] : []),
    ] as const;
    let additional = 0;
    for (const variant of variants) {
      if (!(await this.files.existing(manifest, variant).catch(() => null)))
        additional += manifest.files[variant].sizeBytes;
      check();
    }
    await reserveIllustrationCache(
      this.db,
      this.files,
      manifest,
      additional,
      check,
      this.policy.budgetBytes ?? LAYOUT_ILLUSTRATION_CACHE_BYTES,
      this.displayed.get(message.id),
    );
    for (const variant of variants) {
      if (await this.files.existing(manifest, variant).catch(() => null)) {
        check();
        continue;
      }
      check();
      const bytes = await this.api.download(scope.storeId, manifest, variant);
      check();
      const e = manifest.files[variant];
      if (
        bytes.byteLength !== e.sizeBytes ||
        sourceOriginalHash(bytes) !== e.checksum
      )
        throw Error("LAYOUT_ILLUSTRATION_FILE_INVALID");
      // Register the authenticated, bound manifest before installing its first copy.
      // Partial downloads remain discoverable for safe cleanup/recovery after restart.
      await this.register(message, manifest, scope);
      await this.files.write(manifest, variant, bytes, check);
      check();
    }
    await this.register(message, manifest, scope);
    const view = await this.view(message, manifest);
    check();
    this.displayed.set(message.id, manifest.id);
    return view;
  }
  private async register(
    message: CopilotMessage,
    manifest: LayoutIllustrationManifest,
    scope: { storeId: string; userId: string },
    offlineRequired?: boolean,
  ) {
    const check = () => this.check(scope);
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      check();
      // Revalidate the private source inside this transaction without nesting the original repository transaction.
      const content = readStoreLayoutScenarioCard(message).content;
      await verifyPrivateToolRecord(
        tx,
        { storeId: scope.storeId, ownerId: scope.userId },
        message,
        content.assistantMessageId,
      );
      check();
      const old = await tx.getFirstAsync<{ manifest_json: string }>(
        "SELECT manifest_json FROM copilot_layout_illustration_files WHERE id=?",
        manifest.id,
      );
      if (old && old.manifest_json !== JSON.stringify(manifest))
        throw Error("LAYOUT_ILLUSTRATION_RESULT_IMMUTABLE");
      await tx.runAsync(
        "INSERT OR IGNORE INTO copilot_layout_illustration_files(id,store_id,owner_id,preparation_id,created_at,manifest_json) VALUES(?,?,?,?,?,?)",
        manifest.id,
        scope.storeId,
        scope.userId,
        manifest.preparation.id,
        manifest.createdAt,
        JSON.stringify(manifest),
      );
      const retention = await tx.getFirstAsync<{ required: number }>(
        "SELECT MAX(offline_required) required FROM copilot_layout_illustration_files WHERE preparation_id=? AND store_id=? AND owner_id=?",
        manifest.preparation.id,
        scope.storeId,
        scope.userId,
      );
      await tx.runAsync(
        "UPDATE copilot_layout_illustration_files SET last_accessed_at=?,offline_required=? WHERE id=? AND store_id=? AND owner_id=?",
        this.now(),
        offlineRequired === undefined
          ? retention?.required
            ? 1
            : 0
          : offlineRequired
            ? 1
            : 0,
        manifest.id,
        scope.storeId,
        scope.userId,
      );
      // A newer result must not hide an older pinned version forever. The visible
      // preparation preference applies to all its downloaded result copies.
      if (offlineRequired !== undefined)
        await tx.runAsync(
          "UPDATE copilot_layout_illustration_files SET offline_required=? WHERE preparation_id=? AND store_id=? AND owner_id=?",
          offlineRequired ? 1 : 0,
          manifest.preparation.id,
          scope.storeId,
          scope.userId,
        );
      check();
    });
  }
}
