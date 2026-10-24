/** Synthetic protocol fixtures only. These are NOT generated product images or human approvals. */
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { bootstrapResponseSchema } from "../packages/sync-contracts/src/sync";
import { visualLibraryFixture } from "./test-visual-library-fixtures";
import {
  pilotInputSchema,
  type VisualPilotApi,
} from "../apps/api/src/development/visual-pilot-import";
export async function visualPilotFixture() {
  const f = visualLibraryFixture(),
    root = await mkdtemp(join(tmpdir(), "fl-pilot-protocol-test-"));
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 4; y < 12; y++)
    for (let x = 4; x < 12; x++) {
      const i = (y * 16 + x) * 4;
      pixels[i] = 200;
      pixels[i + 3] = 255;
    }
  const bytes = await sharp(pixels, {
    raw: { width: 16, height: 16, channels: 4 },
  })
    .png()
    .toBuffer();
  await writeFile(join(root, "test-only.png"), bytes);
  await writeFile(
    join(root, "prompt.txt"),
    "SYNTHETIC TEST FIXTURE, no AI generation.",
  );
  await writeFile(
    join(root, "evidence.txt"),
    "Test-only provenance and simulated reviewer. Never production evidence.",
  );
  const input = pilotInputSchema.parse({
    schema: "fl-copilot-visual-pilot/v1",
    pilotId: randomUUID(),
    items: ["tomato_round", "banana_cavendish", "avocado_hass"].map(
      (visualKey, i) => ({
        visualKey,
        canonicalName: `Synthetic ${visualKey}`,
        productId: i === 0 ? f.product.id : randomUUID(),
        file: "test-only.png",
        provenance: {
          type: "AI_GENERATED",
          provider: "TEST_FIXTURE_NOT_REAL_AI",
          model: "TEST_FIXTURE",
          promptVersion: "TEST_ONLY",
        },
        generation: {
          generatedAt: f.at,
          originalFile: "test-only.png",
          promptFile: "prompt.txt",
          evidenceFile: "evidence.txt",
          transformations: [],
        },
      }),
    ),
  });
  const snapshot = bootstrapResponseSchema.parse({
    protocolVersion: 1,
    store: { id: f.storeId, name: "Isolated protocol test", role: "MANAGER" },
    snapshotRevision: "1",
    cursor: "test",
    historyPolicy: { rawObservationDays: 1 },
    entities: {
      syncTestEntities: [],
      productIdentifiers: [],
      productSubstitutions: [],
      salesObservations: [],
      wasteObservations: [],
      commercialOperations: [],
      offers: [],
      marketSignals: [],
      products: [f.product],
      productAliases: [],
      needUnits: [],
      needMemberships: [],
      substitutionRelationships: [],
      commercialDocuments: [],
      commercialOffers: [],
      executionInstructions: [],
      storeEvents: [],
      productDailyPerformance: [],
      departmentDailyPerformance: [],
      recommendations: [],
      decisions: [],
      actionExecutions: [],
      visualLibrary: true,
      visualAssets: [],
      visualIdentities: [],
      productVisualLinks: [],
    },
    serverTime: f.at,
  });
  const unavailable = async (): Promise<never> => {
    throw Error("UNEXPECTED_WRITE_OR_FILE_CALL");
  };
  const api: VisualPilotApi = {
    snapshot: async () => snapshot,
    push: unavailable,
    init: unavailable,
    complete: unavailable,
    manifest: unavailable,
    download: unavailable,
    put: unavailable,
  };
  return {
    f,
    root,
    bytes,
    input,
    snapshot,
    api,
    scope: { storeId: f.storeId, actorId: f.actorId, deviceId: f.deviceId },
  };
}
