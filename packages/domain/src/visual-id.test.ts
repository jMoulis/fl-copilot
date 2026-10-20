import { expect, it } from "vitest";
import { visualIdMaterial, visualIdFromDigest } from "./visual-id";

const store = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
const hash = `sha256:${"a".repeat(64)}`;
it("keeps versioned visual UUIDs stable, scoped and independent of actors/devices", () => {
  const material = visualIdMaterial("visual_asset", store, hash);
  expect(material).toBe(
    JSON.stringify(["fl-copilot.visual_asset.v1", store, hash]),
  );
  expect(
    visualIdFromDigest(
      "c8f7d7659a0e2a6cffa7772d9500b4ba757f243ae36a83ee06c99d793d2115c3",
    ),
  ).toBe("c8f7d765-9a0e-8a6c-bfa7-772d9500b4ba");
  expect(
    visualIdFromDigest(
      "fcf87a3f81a0439115378c56dfec4f7243d0bd22dc0b06d64fd272c47cb2f37a",
    ),
  ).toBe("fcf87a3f-81a0-8391-9537-8c56dfec4f72");
  expect(visualIdMaterial("visual_asset", product, hash)).not.toBe(material);
  expect(
    visualIdMaterial("visual_asset", store, `sha256:${"b".repeat(64)}`),
  ).not.toBe(material);
  expect(visualIdMaterial("product_visual_link", store, product)).not.toBe(
    material,
  );
});
it("refuses malformed namespaces and digests without creating an identity", () => {
  expect(() => visualIdMaterial("visual_asset", "other-store", hash)).toThrow();
  expect(() => visualIdMaterial("visual_asset", store, product)).toThrow();
  expect(() => visualIdMaterial("product_visual_link", store, hash)).toThrow();
  expect(() => visualIdFromDigest("bad digest")).toThrow();
});
