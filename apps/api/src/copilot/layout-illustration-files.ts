import {
  serializeStoreLayoutRevision,
  type StoreLayoutRevisionDocument,
} from "../store-layout-sync";
import { z } from "zod";
import sharp from "sharp";
import {
  detectVisualImageMime,
  copilotMessageSchema,
  layoutIllustrationPreparationSchema,
  sameLayoutIllustrationPreparation,
} from "@fl-copilot/domain";
import {
  layoutIllustrationManifestSchema,
  readLayoutIllustrationManifest,
  serializeLayoutIllustrationMetadata,
  type LayoutIllustrationManifest,
  type LayoutIllustrationFileVariant,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types";
import { AuthError } from "../auth/service";
import {
  createVisualBlobStorage,
  type VisualFileStorage,
} from "../products/visual-file-service";
import {
  readLayoutIllustrationPreparationSource,
  serializeLayoutIllustration,
  type LayoutIllustrationDocument,
} from "./layout-illustration-store";
import {
  compileLayoutIllustrationSource,
  layoutIllustrationHash,
} from "./layout-illustration-source";
import type { createLayoutIllustrationProvider } from "./layout-illustration-provider";
type Scope = { storeId: string; userId: string };
type Document = {
  _id: string;
  storeId: string;
  ownerId: string;
  preparationId: string;
  createdAt: string;
  manifest: LayoutIllustrationManifest;
  status: "STAGING" | "READY";
};
type Output = Awaited<
  ReturnType<ReturnType<typeof createLayoutIllustrationProvider>["generate"]>
>;
const unavailable = () =>
  new AuthError(
    404,
    "LAYOUT_ILLUSTRATION_UNAVAILABLE",
    "Cette illustration n’est pas disponible dans cette conversation.",
  );
const invalid = () => Error("LAYOUT_ILLUSTRATION_FILE_INVALID");
export function layoutIllustrationObjectKey(
  manifest: LayoutIllustrationManifest,
  variant: LayoutIllustrationFileVariant,
) {
  const m = layoutIllustrationManifestSchema.parse(manifest),
    p = m.preparation;
  if (!Object.hasOwn(m.files, variant)) throw invalid();
  return `stores/${p.storeId}/copilot/${p.ownerId}/layout-illustrations/${p.id}/${m.id}/${variant}-${m.files[variant].checksum.slice(7)}.${variant === "data" ? "json" : "png"}`;
}
async function verify(
  bytes: Uint8Array,
  descriptor: LayoutIllustrationManifest["files"][LayoutIllustrationFileVariant],
) {
  if (
    bytes.byteLength !== descriptor.sizeBytes ||
    layoutIllustrationHash(bytes) !== descriptor.checksum
  )
    throw invalid();
  if (descriptor.mimeType === "image/png") {
    if (detectVisualImageMime(bytes) !== "image/png") throw invalid();
    const image = sharp(bytes, {
        failOn: "error",
        limitInputPixels: 2_000_000,
      }),
      m = await image.metadata();
    if (m.width !== 1536 || m.height !== 1024 || (m.pages ?? 1) !== 1)
      throw invalid();
    await image.raw().toBuffer();
  } else {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
}
/** Private source and result delivery only. This service cannot invoke a provider or approve spending. */
export function createLayoutIllustrationFiles(
  database: DatabaseService,
  storage: Pick<
    VisualFileStorage,
    "read" | "writeImmutable"
  > = createVisualBlobStorage(),
) {
  async function source(scope: Scope, preparationId: string) {
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.userId);
    z.uuid().parse(preparationId);
    const db = await database.getDb(),
      row = await db
        .collection<LayoutIllustrationDocument>("copilotLayoutIllustrations")
        .findOne({
          _id: preparationId,
          storeId: scope.storeId,
          ownerId: scope.userId,
        });
    if (!row) throw unavailable();
    const p = serializeLayoutIllustration(row),
      basis = await readLayoutIllustrationPreparationSource(
        db,
        p,
        undefined,
        false,
      );
    if (!basis) throw unavailable();
    return { db, p };
  }
  async function manifestFor(
    scope: Scope,
    preparationId: string,
    resultId?: string,
  ) {
    const { db, p } = await source(scope, preparationId);
    const row = await db
      .collection<Document>("copilotLayoutIllustrationFiles")
      .find({
        storeId: scope.storeId,
        ownerId: scope.userId,
        preparationId,
        status: "READY",
        ...(resultId ? { _id: z.uuid().parse(resultId) } : {}),
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .next();
    if (!row) return null;
    const m = readLayoutIllustrationManifest(row.manifest, p),
      { manifestHash, ...metadata } = m;
    if (
      row._id !== m.id ||
      row.createdAt !== m.createdAt ||
      layoutIllustrationHash(serializeLayoutIllustrationMetadata(metadata)) !==
        manifestHash
    )
      throw invalid();
    return m;
  }
  async function archivalSource(scope: Scope, preparationId: string) {
    // Internal completion writes retain already-produced bytes even after role revocation
    // or logical chat deletion. This is not an authorization path; all reads use source().
    z.uuid().parse(scope.storeId);
    z.uuid().parse(scope.userId);
    z.uuid().parse(preparationId);
    const db = await database.getDb(),
      row = await db
        .collection<LayoutIllustrationDocument>("copilotLayoutIllustrations")
        .findOne({
          _id: preparationId,
          storeId: scope.storeId,
          ownerId: scope.userId,
        });
    if (!row) throw invalid();
    const p = serializeLayoutIllustration(row),
      cardRow = await db
        .collection<{ _id: string } & Record<string, unknown>>(
          "copilotMessages",
        )
        .findOne({
          _id: p.scenarioMessageId,
          storeId: p.storeId,
          ownerId: p.ownerId,
          conversationId: p.conversationId,
        }),
      layoutRow = await db
        .collection<StoreLayoutRevisionDocument>("storeLayoutRevisions")
        .findOne({ _id: p.physicalRevisionId, storeId: p.storeId });
    if (!cardRow || !layoutRow) throw invalid();
    const { _id, ...cardPayload } = cardRow;
    void _id;
    const compiled = await compileLayoutIllustrationSource(
      {
        storeId: p.storeId,
        ownerId: p.ownerId,
        conversationId: p.conversationId,
      },
      copilotMessageSchema.parse(cardPayload),
      serializeStoreLayoutRevision(layoutRow).plan,
    );
    const { schemaVersion, ...fields } = compiled.binding;
    void schemaVersion;
    if (
      !sameLayoutIllustrationPreparation(
        p,
        layoutIllustrationPreparationSchema.parse({
          ...fields,
          id: p.id,
          version: 1,
          intent: "PREPARATION_ONLY",
          createdAt: p.createdAt,
        }),
      )
    )
      throw invalid();
    return { db, p, compiled };
  }
  async function install(
    db: Awaited<ReturnType<DatabaseService["getDb"]>>,
    manifest: LayoutIllustrationManifest,
    bytes: Record<LayoutIllustrationFileVariant, Uint8Array>,
  ) {
    for (const variant of ["original", "source", "image", "data"] as const) {
      await verify(bytes[variant], manifest.files[variant]);
      await storage.writeImmutable(
        layoutIllustrationObjectKey(manifest, variant),
        bytes[variant],
        manifest.files[variant].mimeType,
      );
    }
    const p = manifest.preparation,
      updated = await db
        .collection<Document>("copilotLayoutIllustrationFiles")
        .updateOne(
          {
            _id: manifest.id,
            storeId: p.storeId,
            ownerId: p.ownerId,
            preparationId: p.id,
            "manifest.manifestHash": manifest.manifestHash,
          },
          { $set: { status: "READY" } },
        );
    if (updated.matchedCount !== 1)
      throw Error("LAYOUT_ILLUSTRATION_RESULT_IMMUTABLE");
    return manifest;
  }
  return {
    async manifest(scope: Scope, preparationId: string) {
      const manifest = await manifestFor(scope, preparationId);
      return manifest
        ? { state: "READY" as const, manifest }
        : { state: "EMPTY" as const, preparationId };
    },
    async read(
      scope: Scope,
      preparationId: string,
      resultId: string,
      variant: LayoutIllustrationFileVariant,
    ) {
      const m = await manifestFor(scope, preparationId, resultId);
      if (!m) throw unavailable();
      const descriptor = m.files[variant],
        bytes = await storage.read(
          layoutIllustrationObjectKey(m, variant),
          descriptor.sizeBytes,
        );
      if (!bytes) throw unavailable();
      await verify(bytes, descriptor);
      await source(scope, preparationId);
      return {
        bytes,
        mimeType: descriptor.mimeType,
        checksum: descriptor.checksum,
      };
    },
    /** Internal completion seam for the future authorized attempt worker; no public upload/write route.
     * Original provider bytes, metadata-stripped result, source pixels and structured source are immutable.
     * Publish the manifest only after all four writes, so interrupted persistence can resume without a paid retry. */
    async persist(
      scope: Scope,
      preparationId: string,
      id: string,
      output: Output,
      createdAt: string,
    ) {
      z.uuid().parse(id);
      z.iso.datetime().parse(createdAt);
      const { db, p, compiled } = await archivalSource(scope, preparationId);
      if (
        !compiled.frame ||
        JSON.stringify(compiled.binding) !== JSON.stringify(output.binding) ||
        compiled.frame.contentHash !== output.frame.contentHash ||
        layoutIllustrationHash(output.frame.bytes) !==
          compiled.frame.contentHash
      )
        throw invalid();
      const data = new TextEncoder().encode(
        JSON.stringify({ binding: compiled.binding, source: compiled.source }),
      );
      const descriptor = (value: {
        bytes: Uint8Array;
        mimeType: "image/png";
        contentHash: string;
      }) => ({
        checksum: value.contentHash,
        sizeBytes: value.bytes.byteLength,
        mimeType: value.mimeType,
        width: 1536 as const,
        height: 1024 as const,
      });
      const metadata = {
        id,
        preparation: p,
        createdAt,
        provenance: {
          ...output.provenance,
          responseId: output.provenance.responseId ?? null,
        },
        usage: output.usage,
        limitations: compiled.source.limitations,
        files: {
          source: descriptor(compiled.frame),
          original: descriptor(output.original),
          image: descriptor(output.image),
          data: {
            checksum: layoutIllustrationHash(data),
            sizeBytes: data.byteLength,
            mimeType: "application/json" as const,
          },
        },
      };
      const manifest = layoutIllustrationManifestSchema.parse({
        ...metadata,
        manifestHash: layoutIllustrationHash(
          serializeLayoutIllustrationMetadata(metadata),
        ),
      });
      if (output.image.providerContentHash !== manifest.files.original.checksum)
        throw invalid();
      const bytes = {
        source: compiled.frame.bytes,
        original: output.original.bytes,
        image: output.image.bytes,
        data,
      };
      for (const variant of ["source", "original", "image", "data"] as const)
        await verify(bytes[variant], manifest.files[variant]);
      const normalized = new Uint8Array(
        await sharp(output.original.bytes, {
          failOn: "error",
          limitInputPixels: 2_000_000,
        })
          .png()
          .toBuffer(),
      );
      if (layoutIllustrationHash(normalized) !== manifest.files.image.checksum)
        throw invalid();
      const collection = db.collection<Document>(
          "copilotLayoutIllustrationFiles",
        ),
        old = await collection.findOne({ _id: id });
      if (old && JSON.stringify(old.manifest) !== JSON.stringify(manifest))
        throw Error("LAYOUT_ILLUSTRATION_RESULT_IMMUTABLE");
      const row = {
        _id: id,
        storeId: p.storeId,
        ownerId: p.ownerId,
        preparationId: p.id,
        createdAt,
        manifest,
        status: "STAGING" as const,
      };
      await collection.updateOne(
        { _id: id },
        { $setOnInsert: row },
        { upsert: true },
      );
      const stored = await collection.findOne({ _id: id });
      if (
        !stored ||
        JSON.stringify(stored.manifest) !== JSON.stringify(manifest)
      )
        throw Error("LAYOUT_ILLUSTRATION_RESULT_IMMUTABLE");
      if (stored.status === "READY") return manifest;
      return install(db, manifest, bytes);
    },
    /** Internal recovery from the archived original only, never another provider call. */
    async recover(scope: Scope, preparationId: string, resultId: string) {
      z.uuid().parse(resultId);
      const { db, p, compiled } = await archivalSource(scope, preparationId),
        row = await db
          .collection<Document>("copilotLayoutIllustrationFiles")
          .findOne({
            _id: resultId,
            storeId: p.storeId,
            ownerId: p.ownerId,
            preparationId: p.id,
          });
      if (!row || !compiled.frame) throw invalid();
      const manifest = readLayoutIllustrationManifest(row.manifest, p),
        { manifestHash, ...metadata } = manifest;
      if (
        manifestHash !==
        layoutIllustrationHash(serializeLayoutIllustrationMetadata(metadata))
      )
        throw invalid();
      if (row.status === "READY") return manifest;
      const original = await storage.read(
        layoutIllustrationObjectKey(manifest, "original"),
        manifest.files.original.sizeBytes,
      );
      if (!original) throw Error("LAYOUT_ILLUSTRATION_RESULT_UNCERTAIN");
      await verify(original, manifest.files.original);
      const image = new Uint8Array(
          await sharp(original, {
            failOn: "error",
            limitInputPixels: 2_000_000,
          })
            .png()
            .toBuffer(),
        ),
        data = new TextEncoder().encode(
          JSON.stringify({
            binding: compiled.binding,
            source: compiled.source,
          }),
        );
      return install(db, manifest, {
        original,
        image,
        source: compiled.frame.bytes,
        data,
      });
    },
  };
}
export type LayoutIllustrationFiles = ReturnType<
  typeof createLayoutIllustrationFiles
>;
