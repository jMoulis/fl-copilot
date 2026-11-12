import sharp from "sharp";
import { it, expect, vi } from "vitest";
import { visualLibraryFixture } from "../../../scripts/test-visual-library-fixtures";
import {
  createProductImageProvider,
  inspectGeneratedProductImage,
  productImagePrompt,
} from "../src/products/product-image-provider";
import { alphaProductImageFixture as alphaFixture } from "../../../scripts/test-product-image-fixtures";
it("uses one direct image call, transparent PNG parameters and no paid automatic retry", async () => {
  const bytes = await alphaFixture(),
    f = visualLibraryFixture();
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/images/generations");
      expect(JSON.parse(init!.body as string)).toMatchObject({
        model: "gpt-image-2.6-flare",
        n: 1,
        size: "1024x1024",
        background: "transparent",
        output_format: "png",
        quality: "high",
      });
      return new Response(
        JSON.stringify({
          created: 1,
          data: [{ b64_json: Buffer.from(bytes).toString("base64") }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const result = await createProductImageProvider(
    "sk-synthetic-not-a-real-key",
    "gpt-image-2.6-flare",
    fetcher as typeof fetch,
  ).generate(f.product);
  expect(result.image).toMatchObject({
    width: 1024,
    height: 1024,
    sizeBytes: bytes.length,
    provenance: { type: "AI_GENERATED", model: "gpt-image-2.6-flare" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const fails = vi.fn(
    async () =>
      new Response("{}", {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  );
  await expect(
    createProductImageProvider(
      "sk-synthetic-not-a-real-key",
      "gpt-image-2.6-flare",
      fails,
    ).generate(f.product),
  ).rejects.toThrow();
  expect(fails).toHaveBeenCalledTimes(1);
});
it("requires real transparency and a nonempty product, with the requested dimensions", async () => {
  await expect(
    inspectGeneratedProductImage(await alphaFixture()),
  ).resolves.toMatchObject({ mimeType: "image/png" });
  for (const [width, alpha] of [
    [1024, 1],
    [1024, 0],
    [512, 0],
  ] as const) {
    const bytes = await sharp({
      create: {
        width,
        height: width,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha },
      },
    })
      .png()
      .toBuffer();
    await expect(inspectGeneratedProductImage(bytes)).rejects.toThrow(
      "PRODUCT_IMAGE_",
    );
  }
});
it("uses canonical nature and packaging without prohibiting every package or claiming exact branded packaging", () => {
  const { product } = visualLibraryFixture();
  expect(productImagePrompt(product)).toContain(
    "Loose produce without packaging",
  );
  const prompt = productImagePrompt({
    ...product,
    nature: "PACKAGED",
    label: "TOMATE CERISE 250G",
    packaging: { quantity: "250", unit: "G", sourceLabel: "barquette 250 g" },
  });
  expect(prompt).toContain("generic unbranded");
  expect(prompt).toContain("barquette 250 g");
  expect(prompt).not.toContain("Loose produce");
});
