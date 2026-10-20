import { describe, it, expect } from "vitest";
import {
  VISUAL_LIBRARY_POLICY,
  visualAssetSchema,
  visualIdentitySchema,
  productVisualLinkSchema,
  resolveProductVisual,
  visualAssetObjectKey,
  validateVisualMutation,
  detectVisualImageMime,
  type VisualAsset,
  type VisualIdentity,
  type ProductVisualLink,
} from "./visual-library";
import type { Product } from "./products";
const storeId = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-20T10:00:00.000Z";
const base = {
  createdBy: actor,
  updatedBy: actor,
  storeId,
  version: 1,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
};
const product: Product = {
  ...base,
  id: "33333333-3333-4333-8333-333333333333",
  label: "Tomate vrac France",
  category: "VEGETABLE",
  nature: "BULK",
  salesUnit: "KG",
  status: "ACTIVE",
};
const asset: VisualAsset = visualAssetSchema.parse({
  ...base,
  id: "44444444-4444-4444-8444-444444444444",
  contentHash: `sha256:${"a".repeat(64)}`,
  mimeType: "image/jpeg",
  sizeBytes: 2048,
  width: 512,
  height: 512,
  provenance: {
    type: "USER_UPLOAD",
    rights: "USER_CONFIRMED",
    confirmedBy: actor,
    confirmedAt: at,
  },
  review: { status: "APPROVED", actorId: actor, at },
});
const identity: VisualIdentity = visualIdentitySchema.parse({
  ...base,
  id: "55555555-5555-4555-8555-555555555555",
  canonicalName: "Tomate ronde rouge",
  specificity: "GENERIC",
  variety: null,
  appearance: null,
  brand: null,
  primaryAssetId: asset.id,
});
const link: ProductVisualLink = productVisualLinkSchema.parse({
  ...base,
  id: "66666666-6666-4666-8666-666666666666",
  productId: product.id,
  visualIdentityId: identity.id,
  overrideAssetId: null,
  linkType: "INHERITED_GENERIC",
  verification: "APPROVED",
  verifiedBy: actor,
  verifiedAt: at,
});
const resolve = (
  patch: Partial<Parameters<typeof resolveProductVisual>[0]> = {},
) =>
  resolveProductVisual({
    product,
    assets: [asset],
    identities: [identity],
    links: [link],
    ...patch,
  });
describe("approved visual library resolution", () => {
  it("shares a single asset/identity across distinct SKUs without changing the commercial products", () => {
    const other = { ...product, id: actor, label: "Tomate vrac Espagne" },
      otherLink = { ...link, id: actor, productId: other.id };
    expect(resolve()).toMatchObject({
      kind: "ASSET",
      generic: true,
      illustrative: false,
      asset: { id: asset.id },
    });
    expect(resolve({ product: other, links: [otherLink] })).toMatchObject({
      kind: "ASSET",
      asset: { id: asset.id },
    });
    expect(product.label).toBe("Tomate vrac France");
    expect(other.label).toBe("Tomate vrac Espagne");
    expect(visualAssetObjectKey({ ...asset, id: actor })).toBe(
      visualAssetObjectKey(asset),
    );
    expect(visualAssetObjectKey({ ...asset, storeId: actor })).not.toBe(
      visualAssetObjectKey(asset),
    );
  });
  it("does not guess a link from a similar label or pick a winner between conflicting links", () => {
    expect(resolve({ links: [] })).toEqual({
      kind: "PLACEHOLDER",
      category: "VEGETABLE",
    });
    expect(resolve({ links: [link, { ...link, id: actor }] }).kind).toBe(
      "PLACEHOLDER",
    );
    expect(
      resolve({ links: [{ ...link, verification: "NEEDS_REVIEW" }] }).kind,
    ).toBe("PLACEHOLDER");
  });
  it.each(["PENDING", "REJECTED", "REVOKED"] as const)(
    "does not distribute %s images",
    (status) => {
      expect(
        resolve({ assets: [{ ...asset, review: { ...asset.review, status } }] })
          .kind,
      ).toBe("PLACEHOLDER");
    },
  );
  it("preserves an explicit override even if the primary image changes, and does not fall back when the override is unavailable", () => {
    const override = { ...asset, id: actor },
      choice = {
        ...link,
        linkType: "MANUAL_OVERRIDE" as const,
        overrideAssetId: actor,
      };
    expect(
      resolve({ links: [choice], assets: [asset, override] }),
    ).toMatchObject({ kind: "ASSET", asset: { id: actor } });
    expect(
      resolve({
        links: [choice],
        identities: [{ ...identity, primaryAssetId: null }],
        assets: [override],
      }),
    ).toMatchObject({ kind: "ASSET", asset: { id: actor } });
    expect(resolve({ links: [choice] }).kind).toBe("PLACEHOLDER");
  });
  it("does not portray synthetic packaging as a real product and labels permitted generic illustrations", () => {
    const generated: VisualAsset = {
      ...asset,
      provenance: {
        type: "AI_GENERATED",
        provider: "test",
        model: "disabled",
        promptVersion: "test-v1",
      },
    };
    expect(resolve({ assets: [generated] })).toMatchObject({
      kind: "ASSET",
      generic: true,
      illustrative: true,
    });
    expect(
      resolve({
        assets: [generated],
        identities: [{ ...identity, specificity: "PACKAGED_EXACT" }],
      }).kind,
    ).toBe("PLACEHOLDER");
    expect(
      resolve({ assets: [generated], links: [{ ...link, linkType: "EXACT" }] })
        .kind,
    ).toBe("PLACEHOLDER");
    expect(
      resolve({
        product: { ...product, nature: "PACKAGED" },
        links: [{ ...link, linkType: "EXACT" }],
      }).kind,
    ).toBe("PLACEHOLDER");
    expect(VISUAL_LIBRARY_POLICY.automaticGeneration).toBe(false);
    expect(VISUAL_LIBRARY_POLICY.automaticLookup).toBe(false);
  });
  it("refuses foreign and deleted records at every join", () => {
    for (const field of ["assets", "identities", "links"] as const) {
      const record = { assets: asset, identities: identity, links: link }[
        field
      ];
      for (const patch of [{ storeId: actor }, { deletedAt: at }])
        expect(resolve({ [field]: [{ ...record, ...patch }] }).kind).toBe(
          "PLACEHOLDER",
        );
    }
    expect(resolve({ product: { ...product, status: "INACTIVE" } }).kind).toBe(
      "PLACEHOLDER",
    );
  });
});
describe("visual image metadata and rights", () => {
  it("rejects unknown rights, incomplete attribution, fake approvals and excessive images", () => {
    const parse = (patch: Record<string, unknown>) =>
      visualAssetSchema.safeParse({ ...asset, ...patch }).success;
    expect(parse({ provenance: { type: "USER_UPLOAD" } })).toBe(false);
    const licensed = {
      type: "LICENSED_SOURCE",
      provider: "example",
      sourceUrl: "https://example.test/image",
      license: { type: "UNKNOWN", reference: "Unverified", attribution: null },
    };
    expect(parse({ provenance: licensed })).toBe(false);
    expect(
      parse({
        provenance: {
          ...licensed,
          license: { ...licensed.license, type: "CC_BY" },
        },
      }),
    ).toBe(false);
    expect(
      parse({
        provenance: {
          ...licensed,
          license: {
            ...licensed.license,
            type: "CC_BY",
            attribution: "Author",
          },
        },
      }),
    ).toBe(true);
    expect(
      parse({
        provenance: {
          ...licensed,
          sourceUrl: "https://user:password@example.test/x",
          license: { ...licensed.license, type: "CC0" },
        },
      }),
    ).toBe(false);
    expect(
      parse({ review: { status: "APPROVED", actorId: null, at: null } }),
    ).toBe(false);
    expect(parse({ width: 12000, height: 12000 })).toBe(false);
    expect(parse({ sizeBytes: VISUAL_LIBRARY_POLICY.maximumBytes + 1 })).toBe(
      false,
    );
    expect(parse({ contentHash: "not-a-checksum" })).toBe(false);
    expect(parse({ localUri: "file:///device.jpg" })).toBe(false);
    expect(
      productVisualLinkSchema.safeParse({ ...link, verifiedBy: null }).success,
    ).toBe(false);
    expect(
      productVisualLinkSchema.safeParse({ ...link, overrideAssetId: actor })
        .success,
    ).toBe(false);
  });
});

it("attributes a new or changed rights confirmation without rewriting another uploader’s unchanged decision", () => {
  const ctx = { storeId, actorId: actor, canWrite: true };
  expect(validateVisualMutation("visual_asset", null, asset, ctx)).toEqual(
    asset,
  );
  expect(() =>
    validateVisualMutation(
      "visual_asset",
      null,
      {
        ...asset,
        provenance: { ...asset.provenance, confirmedBy: product.id },
      },
      ctx,
    ),
  ).toThrow("VISUAL_RIGHTS_CONFIRMATION_INVALID");
  const updatedAt = "2026-10-20T12:00:00.000Z",
    next = {
      ...asset,
      version: 2,
      updatedAt,
      updatedBy: product.id,
      review: { ...asset.review, actorId: product.id, at: updatedAt },
    };
  expect(
    validateVisualMutation("visual_asset", asset, next, {
      ...ctx,
      actorId: product.id,
    }),
  ).toEqual(next);
  expect(() =>
    validateVisualMutation(
      "visual_asset",
      asset,
      { ...next, provenance: { ...asset.provenance, confirmedAt: updatedAt } },
      { ...ctx, actorId: product.id },
    ),
  ).toThrow("VISUAL_RIGHTS_CONFIRMATION_INVALID");
});
it("retains an original rights event when retiring an inert draft, but requires fresh rights before restoring it", () => {
  const ctx = { storeId, actorId: actor, canWrite: true },
    later = "2026-10-20T14:00:00.000Z";
  const retired = {
    ...asset,
    updatedAt: later,
    deletedAt: later,
    review: { status: "REVOKED" as const, actorId: actor, at: later },
  };
  expect(
    validateVisualMutation("visual_asset", null, retired, ctx).provenance,
  ).toEqual(asset.provenance);
  expect(() =>
    validateVisualMutation(
      "visual_asset",
      null,
      {
        ...retired,
        provenance: { ...asset.provenance, confirmedBy: product.id },
      },
      ctx,
    ),
  ).toThrow("VISUAL_RIGHTS_CONFIRMATION_INVALID");
  const active = {
    ...retired,
    version: 2,
    deletedAt: null,
    review: { status: "APPROVED" as const, actorId: actor, at: later },
  };
  expect(() =>
    validateVisualMutation("visual_asset", retired, active, ctx),
  ).toThrow("VISUAL_RIGHTS_CONFIRMATION_INVALID");
  expect(
    validateVisualMutation(
      "visual_asset",
      retired,
      { ...active, provenance: { ...asset.provenance, confirmedAt: later } },
      ctx,
    ).deletedAt,
  ).toBeNull();
});

it("recognizes only the supported binary signatures, keeping AVIF out of the HEIF path", () => {
  const ascii = (v: string) =>
    new Uint8Array(Array.from(v, (c) => c.charCodeAt(0)));
  expect(detectVisualImageMime(new Uint8Array([255, 216, 255]))).toBe(
    "image/jpeg",
  );
  expect(
    detectVisualImageMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
  ).toBe("image/png");
  expect(detectVisualImageMime(ascii("RIFF0000WEBP"))).toBe("image/webp");
  expect(detectVisualImageMime(ascii("0000ftypheic0000mif1"))).toBe(
    "image/heic",
  );
  expect(detectVisualImageMime(ascii("0000ftypmif10000"))).toBe("image/heif");
  expect(detectVisualImageMime(ascii("0000ftypavif0000mif1"))).toBeNull();
  expect(detectVisualImageMime(ascii("<svg>"))).toBeNull();
  expect(detectVisualImageMime(new Uint8Array())).toBeNull();
});
