import { readStoreLayoutScenarioCard } from "@fl-copilot/domain";
import { verifyPrivateToolRecord } from "./private-tool-record";
import type { CopilotMessage } from "@fl-copilot/domain";
import {
  readLayoutIllustrationManifest,
  serializeLayoutIllustrationMetadata,
  layoutIllustrationFileStateSchema,
  type LayoutIllustrationManifest,
  type LayoutIllustrationFileVariant,
} from "@fl-copilot/sync-contracts";
import { sourceOriginalHash } from "../documents/source-original-hash";
import type { OutboxDatabase } from "../sync/outbox-repository";
import type { AtomicMutationDatabase } from "../sync/atomic-local-mutation";
import { LayoutIllustrationRepository } from "./layout-illustration-repository";
export interface LayoutIllustrationFilePort {
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
  constructor(
    private db: OutboxDatabase & AtomicMutationDatabase,
    private repository: Pick<LayoutIllustrationRepository, "find">,
    private api: LayoutIllustrationFileTransport,
    private files: LayoutIllustrationFilePort,
    private session: () => { storeId: string; userId: string } | null,
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
    const m = readLayoutIllustrationManifest(raw, record.entity),
      { manifestHash, ...metadata } = m;
    if (
      sourceOriginalHash(serializeLayoutIllustrationMetadata(metadata)) !==
      manifestHash
    )
      throw Error("LAYOUT_ILLUSTRATION_MANIFEST_INVALID");
    return m;
  }
  private async view(manifest: LayoutIllustrationManifest) {
    return {
      manifest,
      sourceUri: await this.files.existing(manifest, "source"),
      imageUri: await this.files.existing(manifest, "image"),
      originalUri: await this.files.existing(manifest, "original"),
    };
  }
  async load(message: CopilotMessage) {
    const scope = this.scope(message),
      record = await this.repository.find(message);
    this.check(scope);
    if (!record) return null;
    const row = await this.db.getFirstAsync<{ manifest_json: string }>(
      "SELECT manifest_json FROM copilot_layout_illustration_files WHERE store_id=? AND owner_id=? AND preparation_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
      scope.storeId,
      scope.userId,
      record.entity.id,
    );
    if (!row) return null;
    const manifest = await this.bound(message, JSON.parse(row.manifest_json)),
      view = await this.view(manifest);
    this.check(scope);
    return view;
  }
  refresh(message: CopilotMessage, original = false) {
    const scope = this.scope(message),
      key = `${scope.storeId}/${scope.userId}/${message.id}/${original}`;
    const pending = this.flights.get(key);
    if (pending) return pending;
    const task = this.receive(message, scope, original);
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
    for (const variant of [
      "source",
      "image",
      ...(original ? ["original" as const] : []),
    ] as const) {
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
      await this.files.write(manifest, variant, bytes, check);
      check();
    }
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
        record.entity.id,
        manifest.createdAt,
        JSON.stringify(manifest),
      );
      check();
    });
    const view = await this.view(manifest);
    check();
    return view;
  }
}
