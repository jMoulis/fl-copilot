import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { illustrationPreparationFixture } from "./test-layout-illustration-preparations";
import {
  compileLayoutIllustrationSource,
  layoutIllustrationHash,
} from "../apps/api/src/copilot/layout-illustration-source";
import {
  layoutIllustrationManifestSchema,
  serializeLayoutIllustrationMetadata,
} from "../packages/sync-contracts/src/index";
import { applyLayoutIllustrationRecord } from "../apps/mobile/src/copilot/layout-illustration-repository";
/** Synthetic geometry and colored test pixels, never an actual generated/store image. */
export async function illustrationAssetsFixture(path = ":memory:") {
  const f = await illustrationPreparationFixture(path),
    preparation = await f.repo.prepare(f.card, f.ids);
  await applyLayoutIllustrationRecord(f.a, f.scope, preparation, 1);
  const compiled = await compileLayoutIllustrationSource(
    f.scope,
    f.card,
    f.reference,
  );
  if (!compiled.frame) throw Error("TEST_GEOMETRY_INCOMPLETE");
  const original = new Uint8Array(
    await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: "#b86b2a" },
    })
      .png()
      .withMetadata({
        exif: {
          IFD0: { ImageDescription: "SYNTHETIC QA PIXELS — no AI call" },
        },
      })
      .toBuffer(),
  );
  const image = new Uint8Array(await sharp(original).png().toBuffer());
  const png = (bytes: Uint8Array) => ({
    bytes: new Uint8Array(bytes),
    contentHash: layoutIllustrationHash(bytes),
    width: 1536,
    height: 1024,
    mimeType: "image/png" as const,
  });
  const output = {
    binding: compiled.binding,
    frame: compiled.frame,
    image: {
      ...png(image),
      providerContentHash: layoutIllustrationHash(original),
    },
    original: png(original),
    provenance: {
      provider: "OPENAI" as const,
      textModel: "synthetic-text",
      imageModel: "synthetic-image",
      promptVersion: "layout-illustration-v1",
      responseId: "synthetic-response",
    },
    limitations: compiled.source.limitations,
    usage: { inputTokens: null, outputTokens: null },
  };
  const data = new TextEncoder().encode(
      JSON.stringify({ binding: compiled.binding, source: compiled.source }),
    ),
    id = randomUUID(),
    createdAt = "2026-10-20T17:00:00.000Z";
  const descriptor = (bytes: Uint8Array) => ({
    checksum: layoutIllustrationHash(bytes),
    sizeBytes: bytes.byteLength,
    mimeType: "image/png" as const,
    width: 1536 as const,
    height: 1024 as const,
  });
  const metadata = {
    id,
    preparation,
    createdAt,
    provenance: output.provenance,
    usage: output.usage,
    limitations: output.limitations,
    files: {
      source: descriptor(compiled.frame.bytes),
      original: descriptor(original),
      image: descriptor(image),
      data: {
        checksum: layoutIllustrationHash(data),
        sizeBytes: data.length,
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
  return {
    ...f,
    preparation,
    output,
    manifest,
    bytes: { source: compiled.frame.bytes, original, image, data },
  };
}
