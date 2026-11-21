import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { procurementFixture } from "./test-procurement-fixtures";
import { storeContextFixture } from "./test-store-context-fixtures";
import { VisualTestDatabase } from "./test-visual-sqlite";
import { runLocalMigrations } from "../apps/mobile/src/db/migrations";
import { applyStoreContext } from "../apps/mobile/src/store/context-repository";
import { ProcurementCatalogueDraftRepository } from "../apps/mobile/src/documents/procurement-catalogue-draft";
import { ProcurementPublicationRepository } from "../apps/mobile/src/documents/procurement-publication";
export const procurementHash = async (bytes: Uint8Array) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
export async function procurementPublicationFixture(
  bytes = new Uint8Array(Buffer.from(JSON.stringify(procurementFixture()))),
  configInput?: ReturnType<typeof storeContextFixture>,
  ownerInput?: string,
  originalUri = "file:///procurement-catalogues/original.json",
) {
  const device = new VisualTestDatabase(new DatabaseSync(":memory:"));
  await runLocalMigrations(device);
  const config = {
    ...(configInput ?? storeContextFixture()),
    pdvCode: "09083",
  };
  await applyStoreContext(device, config.storeId, config);
  const ownerId = ownerInput ?? randomUUID();
  const originals = { read: async () => bytes, sha256: procurementHash };
  const input = {
    id: randomUUID(),
    storeId: config.storeId,
    ownerId,
    sourceDocumentId: randomUUID(),
    sourceRecordId: randomUUID(),
    fileId: randomUUID(),
    filename: "offers.json",
    localUri: originalUri,
    checksum: await procurementHash(bytes),
    importedAt: "2026-11-21T09:00:00.000Z",
    expectedPdv: config.pdvCode,
  };
  const { draft } = await new ProcurementCatalogueDraftRepository(
    device,
    originals,
  ).stage(input, () => undefined);
  const publicationInput = {
    storeId: input.storeId,
    ownerId,
    checksum: input.checksum,
    normalizedChecksum: draft.normalizedChecksum,
    confirmedAt: "2026-11-21T10:00:00.000Z",
    commandId: randomUUID(),
    deviceId: randomUUID(),
  };
  const repository = new ProcurementPublicationRepository(device, originals);
  return {
    device,
    config,
    ownerId,
    originals,
    input,
    draft,
    bytes,
    publicationInput,
    repository,
  };
}
