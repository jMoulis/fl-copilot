import {
  receiptCorrectionInputSchema,
  receiptCorrectionChangeSchema,
  wasteReceiptDraftCandidateSchema,
  type ReceiptCorrectionChange,
  type receiptPublicationSourceSchema,
  type Product,
} from "@fl-copilot/domain";
import { z } from "zod";
import { validateWasteReceiptArithmetic } from "@fl-copilot/analytics-core";
import type { OutboxDatabase } from "../sync/outbox-repository";
import { productToolRepository } from "./product-tool-transaction";
import { readNativeReceiptPublicationReview } from "./receipt-publication-review";
export async function readReceiptCorrectionReview(
  db: OutboxDatabase,
  source: z.infer<typeof receiptPublicationSourceSchema>,
  raw: unknown,
  digest: (text: string) => Promise<string>,
) {
  const input = receiptCorrectionInputSchema.parse(raw);
  if (source.sourceDocumentId !== input.sourceDocumentId)
    throw Error("RECEIPT_CORRECTION_SCOPE");
  const current = await readNativeReceiptPublicationReview(db, source, digest);
  if (current.receipt.processingStatus === "PUBLISHED")
    return {
      current,
      status: "READ_ONLY" as const,
      changes: [],
      updates: [],
      basisHash: current.basisHash,
      warnings: [] as string[],
      header: {},
    };
  if (
    current.receipt.processingStatus !== "TO_VALIDATE" ||
    current.issues.some((i) => i.field === "save")
  )
    throw Error("RECEIPT_CORRECTION_BLOCKED");
  const changes: ReceiptCorrectionChange[] = [];
  const add = (
    field: ReceiptCorrectionChange["field"],
    before: string | null,
    after: string | null,
    lineId: string | null = null,
    lineIndex: number | null = null,
    force = false,
  ) => {
    if (force || before !== after)
      changes.push(
        receiptCorrectionChangeSchema.parse({
          field,
          before,
          after,
          lineId,
          lineIndex,
        }),
      );
  };
  const header: { wasteDate?: string; cashierNumber?: string | null } = {};
  if (
    input.patch.wasteDate !== undefined &&
    input.patch.wasteDate !== current.receipt.confirmedWasteDate
  ) {
    header.wasteDate = input.patch.wasteDate;
    add(
      "wasteDate",
      current.receipt.confirmedWasteDate ?? null,
      header.wasteDate,
    );
  }
  if (
    input.patch.cashierNumber !== undefined &&
    (input.patch.cashierNumber !==
      (current.receipt.confirmedCashierNumber ?? null) ||
      !current.receipt.cashierNumberConfirmedAt)
  ) {
    header.cashierNumber = input.patch.cashierNumber;
    add(
      "cashierNumber",
      current.receipt.cashierNumberConfirmedAt
        ? (current.receipt.confirmedCashierNumber ?? null)
        : "Non confirmé",
      header.cashierNumber,
      null,
      null,
      !current.receipt.cashierNumberConfirmedAt,
    );
  }
  const targets: Array<{
      lineId: string;
      candidates: z.infer<typeof wasteReceiptDraftCandidateSchema>[];
      product: Product | null;
    }> = [],
    warnings: string[] = [];
  const updates = [];
  for (const patch of input.patch.lines ?? []) {
    const existing = current.lines.find((l) => l.line.id === patch.lineId);
    if (!existing) throw Error("RECEIPT_CORRECTION_LINE_UNAVAILABLE");
    const { line } = existing;
    const values = {
      rawLabel: line.rawLabel,
      quantity: line.quantity ?? null,
      quantityUnit: line.quantityUnit ?? null,
      weight: line.weight ?? null,
      unitPrice: line.unitPrice ?? null,
      totalPrice: line.totalPrice ?? null,
      ...patch.values,
    };
    let valuesChanged = false;
    for (const key of Object.keys(patch.values ?? {}) as Array<
      keyof typeof values
    >) {
      const before = line[key] ?? null,
        after = values[key];
      if (before !== after) valuesChanged = true;
      add(key, before, after, line.id, line.sourceLineIndex);
    }
    let productId: string | undefined;
    if (patch.productId !== undefined) {
      const row = await db.getFirstAsync<{
        match_candidates_json: string | null;
      }>(
        "SELECT match_candidates_json FROM waste_lines WHERE id=? AND receipt_id=? AND store_id=?",
        line.id,
        current.receipt.id,
        source.storeId,
      );
      const candidates = z
        .array(wasteReceiptDraftCandidateSchema)
        .max(25)
        .parse(JSON.parse(row?.match_candidates_json ?? "[]"));
      if (
        patch.productId !== line.matchedProductId &&
        !candidates.some((c) => c.productId === patch.productId)
      )
        throw Error("RECEIPT_CORRECTION_CANDIDATE_UNAVAILABLE");
      const product = await productToolRepository(db).getProduct(
        patch.productId,
      );
      if (
        !product ||
        product.entity.storeId !== source.storeId ||
        product.entity.deletedAt ||
        ["ERROR", "CONFLICT"].includes(product.syncState)
      )
        throw Error("RECEIPT_CORRECTION_PRODUCT_UNAVAILABLE");
      targets.push({ lineId: line.id, candidates, product: product.entity });
      if (
        patch.productId !== line.matchedProductId ||
        line.matchStatus !== "MATCHED"
      ) {
        productId = patch.productId;
        add(
          "product",
          line.matchStatus === "MATCHED"
            ? existing.productLabel
            : "À confirmer",
          product.entity.label,
          line.id,
          line.sourceLineIndex,
          true,
        );
      }
    }
    let excluded: boolean | undefined;
    if (
      patch.excluded !== undefined &&
      patch.excluded !== (line.validationStatus === "EXCLUDED")
    ) {
      excluded = patch.excluded;
      add(
        "excluded",
        line.validationStatus === "EXCLUDED" ? "Exclue" : "Incluse",
        excluded ? "Exclue" : "Incluse",
        line.id,
        line.sourceLineIndex,
      );
    }
    if (valuesChanged || productId !== undefined || excluded !== undefined)
      updates.push({
        lineId: line.id,
        values: valuesChanged ? values : null,
        productId,
        excluded,
      });
    if (valuesChanged) {
      const arithmetic = validateWasteReceiptArithmetic([
        {
          sourceLineIndex: line.sourceLineIndex,
          weight: values.weight,
          unitPrice: values.unitPrice,
          totalPrice: values.totalPrice,
        },
      ]).lines[0]!;
      if (arithmetic.status === "MISMATCH")
        warnings.push(
          `Ligne ${line.sourceLineIndex + 1} : le montant proposé reste à vérifier (poids × prix unitaire : ${arithmetic.expectedTotal} €).`,
        );
    }
  }
  const basisHash = await digest(
    JSON.stringify({ current: current.basisHash, targets }),
  );
  return {
    current,
    status: changes.length ? ("READY" as const) : ("UNCHANGED" as const),
    header,
    updates,
    changes,
    warnings,
    basisHash,
  };
}
