import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import sharp from "sharp";
import { illustrationFixture } from "../../../../scripts/test-layout-illustration-fixtures";
import {
  prepareStoreLayoutIllustration,
  prepareStoreLayoutScenario,
} from "@fl-copilot/commercial-core";
import {
  compileLayoutIllustrationSource,
  layoutIllustrationSvg,
} from "./layout-illustration-source";

it("keeps nineteen fixtures, independent upper shelves and immutable allocations without drawing fallbacks", async () => {
  const f = await illustrationFixture(),
    before = JSON.stringify(f);
  const result = await compileLayoutIllustrationSource(
    f.scope,
    f.card,
    f.reference,
  );
  expect(result.source.status).toBe("READY");
  expect(result.source.geometry.counts).toMatchObject({
    fixed: 16,
    tg: 3,
    mobiles: 0,
  });
  expect(
    result.source.layout.content.surfaces.filter(
      (s) => s.kind === "UPPER_SHELF",
    ),
  ).toHaveLength(16);
  expect(result.source.scenario).toEqual(f.scenario);
  expect(await sharp(result.frame!.bytes).metadata()).toMatchObject({
    format: "png",
    width: 1536,
    height: 1024,
  });
  expect(result.source.limitations.join(" ")).toContain(
    "pas d’un relevé mesuré",
  );
  expect(JSON.stringify(f)).toBe(before);
});
it("does not infer missing element geometry from island envelopes or require purchase costs/loads", async () => {
  const f = await illustrationFixture(false),
    result = await compileLayoutIllustrationSource(
      f.scope,
      f.card,
      f.reference,
    );
  expect(result.source.status).toBe("NEEDS_MEASUREMENTS");
  expect(result.frame).toBeNull();
  expect(result.source.required).toHaveLength(16);
  expect(result.source.required[0]).toEqual({
    targetId: f.fixed.id,
    fields: ["x", "y", "rotation", "width", "depth"],
  });
  expect(() => layoutIllustrationSvg(result.source)).toThrow("NOT_READY");
});
it("keeps an explicitly recorded mobile overlaid, with its own surface and unknown vertical fit", async () => {
  const f = await illustrationFixture(),
    id = randomUUID();
  const mobile = {
    ...structuredClone(f.fixed),
    id,
    label: "Mobile déclaré",
    kind: "MOBILE" as const,
    assemblyId: null,
    face: null,
    order: null,
    hostId: f.fixed.id,
    dimensions: {
      ...structuredClone(f.fixed.dimensions),
      width: { mm: 400, quality: "DECLARED" as const },
      depth: { mm: 500, quality: "DECLARED" as const },
    },
  };
  f.reference.content.furniture.unshift(mobile);
  f.reference.content.surfaces.push({
    ...structuredClone(f.surface),
    id: randomUUID(),
    furnitureId: id,
    kind: "MOBILE_DISPLAY",
    label: "Surface du mobile",
  });
  const scenario = prepareStoreLayoutScenario(
    f.scope.storeId,
    f.input,
    f.sources,
  ).scenario!;
  const body = JSON.parse(f.card.text);
  body.scenario = scenario;
  const result = await compileLayoutIllustrationSource(
    f.scope,
    { ...f.card, text: JSON.stringify(body) },
    f.reference,
  );
  expect(result.source.status).toBe("READY");
  expect(result.source.geometry.counts).toMatchObject({
    fixed: 16,
    tg: 3,
    mobiles: 1,
  });
  expect(
    result.source.geometry.issues.some(
      (i) => i.code === "VERTICAL_FIT_UNKNOWN",
    ),
  ).toBe(true);
  expect(
    result.source.layout.content.furniture.find((f) => f.id === id)?.hostId,
  ).toBe(f.fixed.id);
  const svg = layoutIllustrationSvg(result.source);
  expect(svg.indexOf('fill="#e9b765"')).toBeGreaterThan(
    svg.lastIndexOf('fill="#eef1ed"'),
  );
  expect(svg).toContain('stroke-dasharray="5 3"');
});
it.each(["storeId", "ownerId", "conversationId"] as const)(
  "refuses a foreign %s before rendering",
  async (field) => {
    const f = await illustrationFixture();
    await expect(
      compileLayoutIllustrationSource(
        { ...f.scope, [field]: randomUUID() },
        f.card,
        f.reference,
      ),
    ).rejects.toThrow("SCOPE_INVALID");
  },
);
it("refuses another physical revision, source version or unadopted draft", async () => {
  const f = await illustrationFixture();
  for (const patch of [
    { version: f.reference.version + 1 },
    { storeId: randomUUID(), id: randomUUID() },
    { action: "SAVE_DRAFT" as const, referenceRevisionId: f.first.revisionId },
  ])
    expect(() =>
      prepareStoreLayoutIllustration(f.scope.storeId, f.scenario, {
        ...f.reference,
        ...patch,
      }),
    ).toThrow();
});
it("refuses a changed target/label and tampered geometry qualification", async () => {
  const f = await illustrationFixture();
  const label = structuredClone(f.scenario);
  label.assignments[0]!.targetLabel = "Un autre bac";
  expect(() =>
    prepareStoreLayoutIllustration(f.scope.storeId, label, f.reference),
  ).toThrow("TARGET_INVALID");
  const geometry = structuredClone(f.scenario);
  geometry.geometry.missing += 1;
  expect(() =>
    prepareStoreLayoutIllustration(f.scope.storeId, geometry, f.reference),
  ).toThrow("GEOMETRY_INVALID");
});
it("blocks a known collision even if a source scenario records it faithfully", async () => {
  const f = await illustrationFixture();
  Object.assign(
    f.reference.content.furniture.find((x) => x.id === f.tg.id)!,
    { x: f.fixed.x, y: f.fixed.y },
  );
  const scenario = prepareStoreLayoutScenario(
    f.scope.storeId,
    f.input,
    f.sources,
  ).scenario!;
  expect(
    prepareStoreLayoutIllustration(f.scope.storeId, scenario, f.reference)
      .status,
  ).toBe("BLOCKED");
});
it("pins history and binds qualifiers, assignments, assumptions and labels independently of newer state", async () => {
  const f = await illustrationFixture(),
    a = await compileLayoutIllustrationSource(f.scope, f.card, f.reference),
    b = await compileLayoutIllustrationSource(f.scope, f.card, f.reference);
  expect(a.binding).toEqual(b.binding);
  expect(a.frame!.contentHash).toBe(b.frame!.contentHash);
  const card = structuredClone(f.card),
    body = JSON.parse(card.text);
  body.scenario.assumptions = ["Nouvelle hypothèse déclarée"];
  card.text = JSON.stringify(body);
  const c = await compileLayoutIllustrationSource(f.scope, card, f.reference);
  expect(c.binding.scenarioHash).not.toBe(a.binding.scenarioHash);
  const historical = structuredClone(f.reference);
  historical.content.room.width.quality = "MEASURED";
  const d = await compileLayoutIllustrationSource(f.scope, f.card, historical);
  expect(d.binding.physicalHash).not.toBe(a.binding.physicalHash);
});
