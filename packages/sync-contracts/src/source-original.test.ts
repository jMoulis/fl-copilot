import { expect, it } from "vitest";
import {
  sourceOriginalMetadataSchema,
  sourceOriginalManifestSchema,
  sourceOriginalDownloadSchema,
  serializeSourceOriginalMetadata,
} from "./source-original";
import {
  MAX_RECEIPT_BUNDLE_BYTES,
  RECEIPT_PHOTO_BUNDLE_MIME,
} from "@fl-copilot/domain";
const source = {
  schemaVersion: 1,
  sourceDocumentId: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
  access: "OWNER",
  ownerId: "00000000-0000-4000-8000-000000000003",
  sourceType: "STORE_PHOTO",
  filename: "rayon.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 3000,
  checksum: `sha256:${"a".repeat(64)}`,
  registeredAt: "2026-10-20T12:00:00.000Z",
  objectVersion: "etag-source",
};
const manifest = { ...source, manifestHash: `sha256:${"b".repeat(64)}` };
function format(patch: Record<string, unknown>) {
  const kind = patch.sourceType ?? manifest.sourceType;
  return {
    ...manifest,
    access: kind === "STORE_PHOTO" ? "OWNER" : "STORE",
    ownerId: kind === "STORE_PHOTO" ? manifest.ownerId : null,
    ...patch,
  };
}
it("keeps stable exact source metadata independent of download leases and input key order", () => {
  expect(
    serializeSourceOriginalMetadata(
      Object.fromEntries(Object.entries(source).reverse()),
    ),
  ).toBe(serializeSourceOriginalMetadata(source));
  expect(sourceOriginalManifestSchema.parse(manifest)).toEqual(manifest);
  expect(() =>
    sourceOriginalMetadataSchema.parse({
      ...source,
      url: "https://private.invalid",
      objectKey: "private-key",
    }),
  ).toThrow();
  expect(() =>
    sourceOriginalManifestSchema.parse({
      ...manifest,
      localFileUri: "file:///other",
    }),
  ).toThrow();
});
it("preserves the upload byte ceilings and distinguishes each original channel", () => {
  const variants = [
    {
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      mimeType: "application/pdf",
      sizeBytes: 100 * 1024 * 1024,
    },
    {
      sourceType: "MERCALYS_SALES",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 100 * 1024 * 1024,
    },
    {
      sourceType: "MERCALYS_WASTE",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    {
      sourceType: "WASTE_RECEIPT",
      mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      sizeBytes: MAX_RECEIPT_BUNDLE_BYTES,
    },
    { sourceType: "WASTE_RECEIPT", mimeType: "image/heic" },
    { sourceType: "STORE_PHOTO", mimeType: "image/png" },
  ];
  for (const patch of variants)
    expect(sourceOriginalManifestSchema.safeParse(format(patch)).success).toBe(
      true,
    );
  for (const patch of [
    { sourceType: "MERCALYS_SALES", mimeType: "image/jpeg" },
    {
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
    },
    { mimeType: "application/pdf" },
    { sizeBytes: 20 * 1024 * 1024 + 1 },
    {
      sourceType: "WASTE_RECEIPT",
      mimeType: RECEIPT_PHOTO_BUNDLE_MIME,
      sizeBytes: MAX_RECEIPT_BUNDLE_BYTES + 1,
    },
    {
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      mimeType: "application/pdf",
      sizeBytes: 100 * 1024 * 1024 + 1,
    },
  ])
    expect(sourceOriginalManifestSchema.safeParse(format(patch)).success).toBe(
      false,
    );
});
it("accepts only a short-lived private Blob transport shape, without arbitrary destinations", () => {
  const payload = {
    manifest,
    url: "https://test.private.blob.vercel-storage.com/sources/verified?token=test-only",
    expiresAt: "2026-10-20T12:02:00.000Z",
  };
  expect(sourceOriginalDownloadSchema.parse(payload)).toEqual(payload);
  for (const url of [
    "http://test.private.blob.vercel-storage.com/x",
    "https://blob.vercel-storage.com.evil.invalid/x",
    "https://localhost/x",
    "https://test.public.blob.vercel-storage.com/x",
    "file:///private/x",
    "https://user:secret@test.private.blob.vercel-storage.com/x",
    "https://test.private.blob.vercel-storage.com/x#fragment",
  ])
    expect(
      sourceOriginalDownloadSchema.safeParse({ ...payload, url }).success,
    ).toBe(false);
  expect(
    sourceOriginalDownloadSchema.safeParse({
      ...payload,
      objectKey: "model-path",
    }).success,
  ).toBe(false);
});

it("keeps store business originals and owner-private photographs in distinct scopes", () => {
  for (const patch of [
    { access: "STORE", ownerId: null },
    { ownerId: null },
    {
      sourceType: "WEEKLY_COMMERCIAL_PDF",
      mimeType: "application/pdf",
      access: "OWNER",
      ownerId: manifest.ownerId,
    },
  ])
    expect(sourceOriginalManifestSchema.safeParse(format(patch)).success).toBe(
      false,
    );
});
