import * as XLSX from "xlsx";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ReceiptTestDatabase } from "./test-receipt-publication-sqlite";
import {
  mercalysLocalFixture,
  mercalysWorkbook,
} from "./test-mercalys-sync-fixtures";
import { MercalysBatchRepository } from "../apps/mobile/src/documents/mercalys-batch-repository";
import { CopilotConversationRepository } from "../apps/mobile/src/copilot/conversation-repository";
import { CopilotLocalChatController } from "../apps/mobile/src/copilot/local-chat-controller";
import { ProductMasterRepository } from "../apps/mobile/src/products/product-master-repository";
import { SheetJsSpreadsheetParser } from "../apps/mobile/src/documents/sheetjs-spreadsheet-parser";
import { validateMercalysImport } from "../apps/mobile/src/documents/mercalys-import-validation";
import { MercalysImportPublicationRepository } from "../apps/mobile/src/documents/mercalys-import-publication";
import { readMercalysPublication } from "../apps/mobile/src/documents/mercalys-publication-sync";
import {
  emptyProductDraft,
  saveProductEditor,
} from "../apps/mobile/src/products/product-editor-service";
import {
  CopilotMercalysImportController,
  importManifestHash,
} from "../apps/mobile/src/copilot/mercalys-import-controller";
export const chatImportDigest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function chatImportFixture(path = ":memory:") {
  const db = new DatabaseSync(path),
    a = new ReceiptTestDatabase(db),
    scope = {
      storeId: randomUUID(),
      ownerId: randomUUID(),
      deviceId: randomUUID(),
      canImport: true,
    },
    productId = randomUUID();
  // The helper needs only the adapter API, not its concrete class.
  await mercalysLocalFixture(a as never, scope.storeId, productId);
  await a.runAsync(
    "INSERT INTO product_identifiers(id,store_id,product_id,type,value,source,status,version,created_at,updated_at,sync_state,remote_version,dirty) VALUES(?,?,?,'ITM8','00000001','MERCALYS','VALIDATED',1,?,?, 'SYNCED',1,0)",
    randomUUID(),
    scope.storeId,
    productId,
    "2026-10-18T08:00:00.000Z",
    "2026-10-18T08:00:00.000Z",
  );
  const repo = new CopilotConversationRepository(a, scope),
    chat = new CopilotLocalChatController(repo, scope, randomUUID),
    conversation = await chat.create();
  const batches = new MercalysBatchRepository(a, {
      ...scope,
      conversationId: conversation.id,
    }),
    bytes = new Map<string, Uint8Array<ArrayBuffer>>();
  let calls = 0;
  const deps = {
    id: randomUUID,
    digest: chatImportDigest,
    read: async (uri: string) => {
      const b = bytes.get(uri);
      if (!b) throw Error("MISSING");
      return b;
    },
    checksum: async (b: Uint8Array<ArrayBuffer>) =>
      `sha256:${createHash("sha256").update(b).digest("hex")}`,
    classify: async (labels: string[]) => {
      calls++;
      return {
        model: "test-only",
        suggestions: labels.map((label) => ({
          label,
          category: "FRUIT",
          confidence: 0.99,
          reason: "Catégorie de test.",
        })),
      };
    },
  };
  async function add(
    options: {
      review?: boolean;
      flow?: "MERCALYS_SALES" | "MERCALYS_WASTE";
      sales?: number;
      date?: string;
      unknownLabel?: string;
      unknownCode?: string;
      extraUnknown?: { code: string; label: string };
    } = {},
  ) {
    const f = mercalysWorkbook(
        scope.storeId,
        productId,
        options.flow,
        options.date,
        options.sales,
        options.review ?? true,
      ),
      id = randomUUID(),
      uri = `file:///retained/${id}.xlsx`;
    if (options.unknownLabel || options.unknownCode || options.extraUnknown) {
      const workbook = XLSX.read(f.bytes, { type: "array" }),
        sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
      if (options.unknownLabel)
        sheet["C5"] = { t: "s", v: options.unknownLabel };
      if (options.unknownCode !== undefined)
        sheet["A5"] = { t: "s", v: options.unknownCode };
      if (options.extraUnknown)
        XLSX.utils.sheet_add_aoa(
          sheet,
          [
            [
              options.extraUnknown.code,
              null,
              options.extraUnknown.label,
              (options.date ?? "2026-10-07").split("-").reverse().join("/"),
              1,
              null,
              0,
              5,
              null,
              null,
              null,
            ],
          ],
          { origin: "A6" },
        );
      f.bytes = new Uint8Array(
        XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
      );
      f.input.sizeBytes = f.bytes.length;
      f.input.checksum = `sha256:${createHash("sha256").update(f.bytes).digest("hex")}`;
    }
    bytes.set(uri, f.bytes);
    const batch = {
      id: randomUUID(),
      storeId: scope.storeId,
      ownerId: scope.ownerId,
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
      files: [
        {
          id,
          filename: f.input.filename,
          localUri: uri,
          checksum: f.input.checksum,
          sizeBytes: f.bytes.length,
        },
      ],
    };
    await batches.create(batch);
    const message = await chat.sendImportReference(conversation.id, {
      kind: "MERCALYS_CHAT_IMPORT",
      schemaVersion: 1,
      policyVersion: 1,
      batchId: batch.id,
      label: f.input.filename,
      manifestHash: await importManifestHash(batch, chatImportDigest),
    });
    return { f, batch, message };
  }
  return {
    db,
    a,
    scope,
    productId,
    repo,
    chat,
    conversation,
    batches,
    bytes,
    deps,
    add,
    controller: new CopilotMercalysImportController(a, scope, deps),
    calls: () => calls,
  };
}

export async function partialChatImportFixture(
  flow: "MERCALYS_SALES" | "MERCALYS_WASTE" = "MERCALYS_SALES",
  path = ":memory:",
  fuzzy = true,
) {
  const s = await chatImportFixture(path);
  if (fuzzy)
    await s.a.runAsync(
      "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
      s.productId,
    );
  const file = await s.add(
    fuzzy ? { flow, unknownLabel: "PRODUIT A CONFIRMER VRAC" } : { flow },
  );
  const repository = new ProductMasterRepository(s.a);
  const catalog = {
    products: (await repository.listProducts(s.scope.storeId)).map(
      (r) => r.entity,
    ),
    identifiers: (await repository.listIdentifiersByStore(s.scope.storeId)).map(
      (r) => r.entity,
    ),
    aliases: (await repository.listAliasesByStore(s.scope.storeId)).map(
      (r) => r.entity,
    ),
  };
  const summary = validateMercalysImport(
    new SheetJsSpreadsheetParser().parse(file.f.bytes),
    s.scope.storeId,
    catalog,
  );
  const publication = await new MercalysImportPublicationRepository(
    s.a,
    randomUUID,
  ).publish({
    ...file.f.input,
    localFileUri: file.batch.files[0]!.localUri,
    summary,
  });
  const initial = (await readMercalysPublication(
    s.a,
    s.scope.storeId,
    publication.sourceDocumentId,
  ))!;
  return { ...s, file, summary, publication, initial };
}

export async function chatImportCatalogueChoice(
  s: Awaited<ReturnType<typeof chatImportFixture>>,
  flow: "MERCALYS_SALES" | "MERCALYS_WASTE" = "MERCALYS_SALES",
  withoutCode = false,
) {
  await s.a.runAsync(
    "UPDATE products SET label='PRODUIT A CONFIRMER' WHERE id=?",
    s.productId,
  );
  const targetId = await saveProductEditor(
    new ProductMasterRepository(s.a),
    {
      ...emptyProductDraft,
      label: "MELON CHARENTAIS PIECE",
      category: "FRUIT",
      nature: "BULK",
      salesUnit: "PIECE",
    },
    { ...s.scope, now: () => new Date().toISOString(), generateId: randomUUID },
  );
  const file = await s.add({
    flow,
    unknownLabel: "PRODUIT A CONFIRMER VRAC",
    ...(withoutCode ? { unknownCode: "" } : {}),
  });
  const review = (await s.controller.run(file.message)).items[0]!;
  if (review.status !== "REVIEW") throw Error("Expected product review");
  const resolution = review.resolutions[0]!;
  if (resolution.candidateProductIds.includes(targetId))
    throw Error("Expected non-suggested target");
  return {
    file,
    review,
    resolution,
    targetId,
    choice: {
      resolutionKey: resolution.key,
      productId: targetId,
      catalogueSelection: true as const,
    },
  };
}
