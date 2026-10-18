import {
  COPILOT_RECEIPT_REVIEW_LINE_LIMIT,
  type Product,
  type WasteLine,
  type WasteReceipt,
  type receiptPublicationSourceSchema,
} from "@fl-copilot/domain";
import type { z } from "zod";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { WasteReceiptRepository } from "../documents/waste-receipt-repository";
import { WasteReceiptPublicationRepository } from "../documents/waste-receipt-publication";
import {
  joinedProductToolDatabase,
  productToolRepository,
} from "./product-tool-transaction";
/** Local draft corrections are intentionally not inferred from the server extraction. */
export async function readNativeReceiptPublicationReview(
  db: OutboxDatabase,
  source: z.infer<typeof receiptPublicationSourceSchema>,
  digest: (text: string) => Promise<string>,
) {
  const record = await db.getFirstAsync<{
    id: string;
    store_id: string;
    checksum: string;
    original_filename: string;
    remote_upload_status: string;
    deleted_at: string | null;
    sync_state: string;
  }>(
    "SELECT * FROM source_documents WHERE id=? AND store_id=? AND source_type='WASTE_RECEIPT'",
    source.sourceDocumentId,
    source.storeId,
  );
  if (
    !record ||
    record.deleted_at ||
    record.checksum !== source.checksum ||
    record.original_filename !== source.filename
  )
    throw Error("RECEIPT_SOURCE_CHANGED");
  const receipts = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM waste_receipts WHERE source_document_id=? AND store_id=? AND deleted_at IS NULL LIMIT 2",
    source.sourceDocumentId,
    source.storeId,
  );
  if (receipts.length !== 1) throw Error("RECEIPT_LOCAL_UNAVAILABLE");
  const count = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) n FROM waste_lines WHERE receipt_id=? AND deleted_at IS NULL",
    receipts[0]!.id,
  );
  if (!count || count.n > COPILOT_RECEIPT_REVIEW_LINE_LIMIT)
    throw Error("RECEIPT_REVIEW_LIMIT");
  const joined = joinedProductToolDatabase(db),
    detail = await new WasteReceiptRepository(joined).getReceiptDetail(
      receipts[0]!.id,
    );
  if (
    !detail ||
    detail.receipt.storeId !== source.storeId ||
    detail.lines.some(
      (d) =>
        d.line.storeId !== source.storeId ||
        d.line.receiptId !== detail.receipt.id,
    )
  )
    throw Error("RECEIPT_LOCAL_UNAVAILABLE");
  const products = new Map<string, Product>();
  const productConflicts = new Set<string>();
  let conflict =
    ["ERROR", "CONFLICT"].includes(record.sync_state) ||
    [detail.receipt, ...detail.lines.map((l) => l.line)].some((r) =>
      ["ERROR", "CONFLICT"].includes(r.syncState),
    );
  for (const { line } of detail.lines) {
    if (!line.matchedProductId || products.has(line.matchedProductId)) continue;
    const product = await productToolRepository(db).getProduct(
      line.matchedProductId,
    );
    if (product && product.entity.storeId === source.storeId) {
      products.set(product.entity.id, product.entity);
      if (["ERROR", "CONFLICT"].includes(product.syncState))
        productConflicts.add(product.entity.id);
    }
  }
  conflict ||= detail.lines.some(
    ({ line }) =>
      line.validationStatus !== "EXCLUDED" &&
      !!line.matchedProductId &&
      productConflicts.has(line.matchedProductId),
  );
  const report = await new WasteReceiptPublicationRepository(joined).inspect(
    detail.receipt.id,
    source.storeId,
  );
  const business = (r: WasteReceipt | WasteLine) => {
    const { syncState, remoteVersion, dirty, ...value } = r;
    void syncState;
    void remoteVersion;
    void dirty;
    return value;
  };
  const basisHash = await digest(
    JSON.stringify({
      source: {
        ...source,
        filename: record.original_filename,
        remoteUploadStatus: record.remote_upload_status,
      },
      receipt: business(detail.receipt),
      lines: detail.lines.map((l) => business(l.line)),
      products: [...products.values()].sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
  return {
    receipt: detail.receipt,
    lines: detail.lines.map((l) => ({
      line: l.line,
      productLabel:
        products.get(l.line.matchedProductId ?? "")?.label ??
        "Produit à identifier",
    })),
    issues: conflict
      ? [
          ...report.issues,
          {
            field: "save" as const,
            message:
              "Résolvez le conflit ou l’erreur de synchronisation avant de publier ce ticket.",
          },
        ]
      : report.issues,
    warnings: report.warnings,
    basisHash,
  };
}
