import sharp from "sharp";
import { randomBytes } from "node:crypto";
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

it("preserves transparent PNG pixels in the opted-in preview while keeping legacy JPEG unchanged", async () => {
  const bytes = await sharp({
    create: {
      width: 40,
      height: 40,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 16,
            height: 16,
            channels: 4,
            background: { r: 240, g: 20, b: 10, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
        left: 12,
        top: 12,
      },
    ])
    .png()
    .toBuffer();
  const asset = {
    ...visualLibraryFixture().asset,
    mimeType: "image/png" as const,
    width: 40,
    height: 40,
    sizeBytes: bytes.byteLength,
    contentHash: visualBytesHash(bytes),
  };
  const preview = await visualImageProcessor.normalize(bytes, asset, true);
  const pixels = await sharp(preview.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(pixels.data[3]).toBe(0);
  expect(pixels.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  expect((await sharp(preview.bytes).metadata()).format).toBe("png");
  expect(
    (
      await sharp(
        (await visualImageProcessor.normalize(bytes, asset)).bytes,
      ).metadata()
    ).format,
  ).toBe("jpeg");
  expect(visualBytesHash(bytes)).toBe(asset.contentHash);
});

it("keeps a noisy transparent preview within the existing byte cap without flattening alpha", async () => {
  const bytes = await sharp(randomBytes(1024 * 1024 * 4), {
    raw: { width: 1024, height: 1024, channels: 4 },
  })
    .png()
    .toBuffer();
  const asset = {
    ...visualLibraryFixture().asset,
    mimeType: "image/png" as const,
    width: 1024,
    height: 1024,
    sizeBytes: bytes.byteLength,
    contentHash: visualBytesHash(bytes),
  };
  const preview = await visualImageProcessor.normalize(bytes, asset, true);
  const metadata = await sharp(preview.bytes).metadata();
  expect(preview.bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(metadata).toMatchObject({
    format: "png",
    hasAlpha: true,
    width: 512,
    height: 512,
  });
});
