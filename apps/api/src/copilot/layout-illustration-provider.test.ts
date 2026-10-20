import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { illustrationFixture } from "../../../../scripts/test-layout-illustration-fixtures";
import {
  createLayoutIllustrationProvider,
  LayoutIllustrationOutcomeUnknown,
} from "./layout-illustration-provider";

const config = {
  enabled: true,
  apiKey: "test-only-not-a-real-key",
  textModel: "test-response-model",
  imageModel: "test-image-model",
};
async function png(width = 1536, height = 1024) {
  return sharp({
    create: { width, height, channels: 3, background: "#235b3e" },
  })
    .png()
    .toBuffer();
}
function response(outputs: unknown[]) {
  return new Response(
    JSON.stringify({
      id: "resp_local_illustration",
      object: "response",
      model: "test-response-model",
      created_at: 1,
      status: "completed",
      incomplete_details: null,
      output: outputs,
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
const imageResult = (result: string, id = "img-local-1") => ({
  type: "image_generation_call",
  id,
  result,
});

it("uses the installed Responses SDK with actual source pixels, one forced image tool and no provider lookup or global-prompt change", async () => {
  const f = await illustrationFixture(),
    output = await png();
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: config.textModel,
      store: false,
      parallel_tool_calls: false,
      max_tool_calls: 1,
      max_output_tokens: 1000,
    });
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "image_generation",
        model: config.imageModel,
        action: "generate",
        output_format: "png",
        size: "1536x1024",
        quality: "low",
        partial_images: 0,
      }),
    ]);
    expect(body.tool_choice).toEqual({ type: "image_generation" });
    const content = body.input.flatMap(
      (m: { content: unknown[] }) => m.content,
    );
    const image = content.find(
      (m: { type: string }) => m.type === "input_image",
    );
    expect(image.image_url).toMatch(/^data:image\/png;base64,/);
    const source = Buffer.from(image.image_url.split(",")[1], "base64");
    expect(await sharp(source).metadata()).toMatchObject({
      width: 1536,
      height: 1024,
    });
    const serialized = JSON.stringify(body.input);
    expect(serialized).toContain(f.scenario.physicalRevisionId);
    expect(serialized).toContain(f.scenario.assignments[0]!.surfaceId);
    expect(serialized).toContain(f.scenario.items[0]!.label);
    expect(serialized).toContain("untrusted source text");
    return response([imageResult(output.toString("base64"))]);
  });
  const result = await createLayoutIllustrationProvider(
    config,
    transport,
  ).generate(f.scope, f.card, f.reference);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(result.provenance).toEqual({
    provider: "OPENAI",
    textModel: config.textModel,
    imageModel: config.imageModel,
    promptVersion: "layout-illustration-v1",
    responseId: "resp_local_illustration",
  });
  expect(result.binding.physicalRevisionId).toBe(f.reference.revisionId);
  expect(result.binding.scenarioMessageId).toBe(f.card.id);
  expect(result.image.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(result.original.bytes).toEqual(new Uint8Array(output));
  expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 10 });
  expect(await sharp(result.image.bytes).metadata()).toMatchObject({
    format: "png",
    width: 1536,
    height: 1024,
  });
});
it("refuses an oversized complete source rather than truncating the inventory or spending on it", async () => {
  const f = await illustrationFixture(),
    transport = vi.fn<typeof fetch>();
  while (f.reference.content.surfaces.length < 384)
    f.reference.content.surfaces.push({
      id: randomUUID(),
      furnitureId: f.tg.id,
      kind: "OTHER",
      label: "果".repeat(120),
      dimensions: structuredClone(f.surface.dimensions),
      maxLoadKg: null,
    });
  await expect(
    createLayoutIllustrationProvider(config, transport).generate(
      f.scope,
      f.card,
      f.reference,
    ),
  ).rejects.toThrow("INPUT_LIMIT");
  expect(transport).not.toHaveBeenCalled();
});
it("does no request when disabled, unconfigured, cancelled, foreign or missing source geometry", async () => {
  const f = await illustrationFixture(),
    transport = vi.fn<typeof fetch>();
  for (const settings of [
    { ...config, enabled: false },
    { ...config, textModel: "" },
    { ...config, apiKey: undefined },
  ])
    await expect(
      createLayoutIllustrationProvider(settings, transport).generate(
        f.scope,
        f.card,
        f.reference,
      ),
    ).rejects.toThrow();
  const abort = new AbortController();
  abort.abort();
  await expect(
    createLayoutIllustrationProvider(config, transport).generate(
      f.scope,
      f.card,
      f.reference,
      abort.signal,
    ),
  ).rejects.toThrow();
  const incomplete = await illustrationFixture(false);
  await expect(
    createLayoutIllustrationProvider(config, transport).generate(
      incomplete.scope,
      incomplete.card,
      incomplete.reference,
    ),
  ).rejects.toThrow("NOT_READY");
  await expect(
    createLayoutIllustrationProvider(config, transport).generate(
      { ...f.scope, ownerId: f.reference.updatedBy },
      f.card,
      f.reference,
    ),
  ).rejects.toThrow("SCOPE_INVALID");
  expect(transport).not.toHaveBeenCalled();
});
it.each(["network", "503", "429"])(
  "does not repeat a %s failure and exposes no provider body or source",
  async (failure) => {
    const f = await illustrationFixture();
    const transport = vi.fn<typeof fetch>(async () => {
      if (failure === "network") throw Error("PRIVATE PROVIDER PAYLOAD");
      return new Response(
        JSON.stringify({ error: { message: "PRIVATE PROVIDER PAYLOAD" } }),
        {
          status: Number(failure),
          headers: { "content-type": "application/json" },
        },
      );
    });
    await expect(
      createLayoutIllustrationProvider(config, transport).generate(
        f.scope,
        f.card,
        f.reference,
      ),
    ).rejects.toEqual(new LayoutIllustrationOutcomeUnknown());
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
it("retains an uncertain outcome after cancellation once the provider request has begun", async () => {
  const f = await illustrationFixture(),
    abort = new AbortController();
  const transport = vi.fn<typeof fetch>(async () => {
    abort.abort();
    throw Error("cancelled provider");
  });
  await expect(
    createLayoutIllustrationProvider(config, transport).generate(
      f.scope,
      f.card,
      f.reference,
      abort.signal,
    ),
  ).rejects.toBeInstanceOf(LayoutIllustrationOutcomeUnknown);
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each([
  "none",
  "multiple",
  "url",
  "invalid",
  "wrong-size",
  "jpeg",
  "oversized",
])(
  "refuses %s output as possibly billed, never as a safe automatic retry",
  async (kind) => {
    const f = await illustrationFixture();
    const encoded =
      kind === "url"
        ? "https://untrusted.invalid/picture.png"
        : kind === "invalid"
          ? "AAAA"
          : kind === "oversized"
            ? "A".repeat(16 * 1024 * 1024 + 4)
            : kind === "jpeg"
              ? (
                  await sharp(await png())
                    .jpeg()
                    .toBuffer()
                ).toString("base64")
              : (await png(kind === "wrong-size" ? 32 : 1536)).toString(
                  "base64",
                );
    const outputs =
      kind === "none"
        ? []
        : kind === "multiple"
          ? [imageResult(encoded), imageResult(encoded, "img-local-2")]
          : [imageResult(encoded)];
    const transport = vi.fn<typeof fetch>(async () => response(outputs));
    await expect(
      createLayoutIllustrationProvider(config, transport).generate(
        f.scope,
        f.card,
        f.reference,
      ),
    ).rejects.toEqual(new LayoutIllustrationOutcomeUnknown());
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
