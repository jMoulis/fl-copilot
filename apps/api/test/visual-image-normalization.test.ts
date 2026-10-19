import sharp from "sharp";
import { it, expect } from "vitest";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import {
  visualBytesHash,
  visualImageProcessor,
} from "../src/products/visual-image-normalization";
it("checks the actual source bytes and yields a bounded JPEG without EXIF or orientation tags", async () => {
  const bytes = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "#cc3322" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const asset = {
    ...visualLibraryFixture().asset,
    mimeType: "image/jpeg" as const,
    width: 1200,
    height: 600,
    sizeBytes: bytes.byteLength,
    contentHash: visualBytesHash(bytes),
  };
  const normalized = await visualImageProcessor.normalize(bytes, asset),
    metadata = await sharp(normalized.bytes).metadata();
  expect(normalized).toMatchObject({ width: 512, height: 1024 });
  expect(metadata.format).toBe("jpeg");
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  // Image picker dimensions can already reflect the source's orientation.
  expect(
    await visualImageProcessor.normalize(bytes, {
      ...asset,
      width: 600,
      height: 1200,
    }),
  ).toMatchObject({ width: 512, height: 1024 });
});
it("refuses a forged hash, source MIME, size and dimensions before publishing any preview", async () => {
  const bytes = await sharp({
    create: { width: 32, height: 16, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const asset = {
    ...visualLibraryFixture().asset,
    mimeType: "image/png" as const,
    width: 32,
    height: 16,
    sizeBytes: bytes.byteLength,
    contentHash: visualBytesHash(bytes),
  };
  expect(await visualImageProcessor.normalize(bytes, asset)).toMatchObject({
    width: 32,
    height: 16,
  });
  for (const patch of [
    { contentHash: `sha256:${"0".repeat(64)}` },
    { mimeType: "image/jpeg" as const },
    { sizeBytes: bytes.byteLength + 1 },
    { width: 31 },
  ])
    await expect(
      visualImageProcessor.normalize(bytes, { ...asset, ...patch }),
    ).rejects.toThrow();
  const disguised = Buffer.from(
    "<svg width='32' height='16' xmlns='http://www.w3.org/2000/svg'></svg>",
  );
  await expect(
    visualImageProcessor.normalize(disguised, {
      ...asset,
      sizeBytes: disguised.byteLength,
      contentHash: visualBytesHash(disguised),
    }),
  ).rejects.toThrow("VISUAL_FILE_INVALID");
});
