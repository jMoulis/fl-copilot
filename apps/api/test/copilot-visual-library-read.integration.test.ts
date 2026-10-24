import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Document } from "mongodb";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  visualLibraryFixture,
  testVisualId,
} from "../../../scripts/test-visual-library-fixtures";
import { readVisualLibrary } from "../src/copilot/visual-library-tool";
import { validateCopilotVisualLookup } from "@fl-copilot/domain";
const uri = process.env.TEST_MONGODB_URI;
describe.skipIf(!uri)("scoped product visual metadata lookup", () => {
  let client: MongoClient, db: Db;
  beforeAll(async () => {
    client = await MongoClient.connect(uri!);
    db = client.db(
      `fl_visual_lookup_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    );
  });
  afterAll(async () => {
    try {
      await db?.dropDatabase();
    } finally {
      await client?.close();
    }
  });
  const put = async <T extends { id: string }>(name: string, e: T) => {
    await db
      .collection<Document & { _id: string }>(name)
      .insertOne({ _id: e.id, ...e });
  };
  it("returns a product link, identity and image together without binary, URL or rights-authority payloads", async () => {
    const f = visualLibraryFixture();
    await put("products", {
      ...f.product,
      createdAt: new Date(f.product.createdAt),
      updatedAt: new Date(f.product.updatedAt),
    });
    await put("productVisualLinks", f.link);
    await put("visualIdentities", f.identity);
    const asset = {
      ...f.asset,
      provenance: {
        type: "SUPPLIER",
        provider: "Fixture",
        sourceUrl: "https://example.invalid/private?token=not-for-the-model",
        license: {
          type: "COMMERCIAL_LICENSE",
          reference: "Fixture permission",
          attribution: null,
        },
      },
    };
    await put("visualAssets", asset);
    const result = await readVisualLibrary(db, f.storeId, {
      productId: f.product.id,
      kind: null,
      cursor: null,
    });
    expect(result.status).toBe("AVAILABLE");
    expect(result.entries.map((e) => e.kind)).toEqual([
      "PRODUCT_VISUAL_LINK",
      "VISUAL_IDENTITY",
      "VISUAL_ASSET",
    ]);
    expect(result.resolution).toEqual({
      kind: "ASSET",
      assetId: f.asset.id,
      identityId: f.identity.id,
      linkId: f.link.id,
      illustrative: false,
      generic: true,
    });
    expect(result.entries.at(-1)!.metadata.id).toBe(f.asset.id);
    expect(result.product?.label).toBe(f.product.label);
    expect(JSON.stringify(result)).not.toMatch(
      /sourceUrl|https:|token=|license|confirmedBy|localUri|storageKey/,
    );
    expect(
      (
        await readVisualLibrary(db, randomUUID(), {
          productId: f.product.id,
          kind: null,
          cursor: null,
        })
      ).status,
    ).toBe("PRODUCT_UNAVAILABLE");
    expect(() =>
      validateCopilotVisualLookup(f.storeId, result.input, {
        ...result,
        entries: result.entries.map((e) => ({
          ...e,
          metadata: { ...e.metadata, storeId: randomUUID() },
        })),
      }),
    ).toThrow("SCOPE");
  });
  it("reports absent synchronized parents as partial rather than inventing an available image", async () => {
    const f = visualLibraryFixture();
    await put("products", {
      ...f.product,
      createdAt: new Date(f.product.createdAt),
      updatedAt: new Date(f.product.updatedAt),
    });
    await put("productVisualLinks", f.link);
    const result = await readVisualLibrary(db, f.storeId, {
      productId: f.product.id,
      kind: null,
      cursor: null,
    });
    expect(result.status).toBe("PARTIAL");
    expect(new Set(result.missingRelatedIds)).toEqual(
      new Set([f.identity.id, f.asset.id]),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.resolution).toEqual({
      kind: "PLACEHOLDER",
      category: f.product.category,
    });
  });
  it.each(["APPROVED", "REVOKED"] as const)(
    "uses the canonical override selection and approval policy (%s)",
    async (reviewStatus) => {
      const f = visualLibraryFixture(),
        hash = `sha256:${"f".repeat(64)}`,
        primary = {
          ...f.asset,
          id: testVisualId("visual_asset", f.storeId, hash),
          contentHash: hash,
        };
      await put("products", {
        ...f.product,
        createdAt: new Date(f.product.createdAt),
        updatedAt: new Date(f.product.updatedAt),
      });
      await put("productVisualLinks", f.link);
      await put("visualIdentities", {
        ...f.identity,
        primaryAssetId: primary.id,
      });
      await put("visualAssets", primary);
      await put("visualAssets", {
        ...f.asset,
        review: { ...f.asset.review, status: reviewStatus },
      });
      const result = await readVisualLibrary(db, f.storeId, {
        productId: f.product.id,
        kind: null,
        cursor: null,
      });
      expect(result.entries).toHaveLength(4);
      expect(result.resolution?.kind).toBe(
        reviewStatus === "APPROVED" ? "ASSET" : "PLACEHOLDER",
      );
      if (result.resolution?.kind === "ASSET")
        expect(result.resolution.assetId).toBe(f.asset.id);
      expect(() =>
        validateCopilotVisualLookup(f.storeId, result.input, {
          ...result,
          resolution: {
            kind: "ASSET",
            assetId: primary.id,
            identityId: f.identity.id,
            linkId: f.link.id,
            generic: true,
            illustrative: false,
          },
        }),
      ).toThrow("SCOPE");
    },
  );
  it("paginates ten metadata records and keeps withdrawn records visible without reactivation", async () => {
    const f = visualLibraryFixture();
    for (let i = 0; i < 11; i++) {
      const hash = `sha256:${i.toString(16).padStart(64, "0")}`,
        asset = {
          ...f.asset,
          id: testVisualId("visual_asset", f.storeId, hash),
          contentHash: hash,
          ...(i === 0 ? { deletedAt: f.asset.updatedAt } : {}),
        };
      await put("visualAssets", asset);
    }
    const first = await readVisualLibrary(db, f.storeId, {
      productId: null,
      kind: "VISUAL_ASSET",
      cursor: null,
    });
    expect(first.entries).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const last = await readVisualLibrary(db, f.storeId, {
      productId: null,
      kind: "VISUAL_ASSET",
      cursor: first.nextCursor,
    });
    expect(last.entries).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    const ids = [...first.entries, ...last.entries].map((e) => e.metadata.id);
    expect(new Set(ids).size).toBe(11);
    expect(
      [...first.entries, ...last.entries].some(
        (e) => e.metadata.deletedAt !== null,
      ),
    ).toBe(true);
    const empty = await readVisualLibrary(db, randomUUID(), {
      productId: null,
      kind: "VISUAL_ASSET",
      cursor: null,
    });
    expect(empty.entries).toEqual([]);
    expect(empty.evidence).toHaveLength(1);
  });
  it("refuses mixed scope filters and corrupt canonical visual identities", async () => {
    const f = visualLibraryFixture();
    await expect(
      readVisualLibrary(db, f.storeId, {
        productId: f.product.id,
        kind: "VISUAL_ASSET",
        cursor: null,
      }),
    ).rejects.toThrow();
    await put("visualAssets", { ...f.asset, id: randomUUID() });
    await expect(
      readVisualLibrary(db, f.storeId, {
        productId: null,
        kind: "VISUAL_ASSET",
        cursor: null,
      }),
    ).rejects.toThrow("ID_INVALID");
  });
  it("finds a named library identity with an escaped literal query, preserving old unfiltered inputs", async () => {
    const f = visualLibraryFixture();
    await put("visualIdentities", {
      ...f.identity,
      canonicalName: "TOMATE (BIO)",
    });
    await put("visualIdentities", {
      ...f.identity,
      id: randomUUID(),
      canonicalName: "TOMATE X",
    });
    await put("visualIdentities", {
      ...f.identity,
      id: randomUUID(),
      storeId: randomUUID(),
      canonicalName: "TOMATE (BIO)",
    });
    const input = {
        productId: null,
        kind: "VISUAL_IDENTITY",
        cursor: null,
        query: "(bio)",
      },
      result = await readVisualLibrary(db, f.storeId, input);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.metadata.id).toBe(f.identity.id);
    expect(
      (await readVisualLibrary(db, f.storeId, { ...input, query: "." }))
        .entries,
    ).toEqual([]);
    const old = { productId: null, kind: "VISUAL_IDENTITY", cursor: null };
    expect((await readVisualLibrary(db, f.storeId, old)).input).toEqual(old);
    await expect(
      readVisualLibrary(db, f.storeId, { ...input, kind: "VISUAL_ASSET" }),
    ).rejects.toThrow();
    await expect(
      readVisualLibrary(db, f.storeId, {
        ...input,
        productId: f.product.id,
        kind: null,
      }),
    ).rejects.toThrow();
  });
});
