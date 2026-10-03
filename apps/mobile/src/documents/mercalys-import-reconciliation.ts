import type { OutboxDatabase } from "../sync/outbox-repository";
import type {
  MercalysImportValidationLine,
  MercalysImportValidationSummary,
} from "./mercalys-import-validation";
import type { ParsedMercalysArticleRecord } from "./mercalys-article-parser";
import type { MercalysSourceType } from "./mercalys-source-detector";

export type ReconciliationCategory =
  "UNCHANGED" | "ADDED" | "REMOVED" | "MODIFIED" | "AMBIGUOUS";

export interface ReconciliationValues {
  quantity: string | null;
  purchaseValue: string | null;
  rceValue: string | null;
  salesValue: string | null;
  vatValue: string | null;
  marginValue: string | null;
  marginRate: string | null;
}

export interface MercalysReconciliationRow {
  key: string;
  category: ReconciliationCategory;
  productId: string | null;
  productLabel: string;
  businessDate: string;
  incomingSourceIndex: number | null;
  incomingRecord: ParsedMercalysArticleRecord | null;
  existingObservationIds: string[];
  existingSourceRecordIds: string[];
  existingValues: ReconciliationValues | null;
  incomingValues: ReconciliationValues | null;
  reason:
    | "UNRESOLVED_PRODUCT"
    | "MULTIPLE_INCOMING_ROWS"
    | "MULTIPLE_EXISTING_ROWS"
    | "UNRESOLVED_ROW_ON_DATE"
    | null;
}

export interface MercalysReconciliation {
  sourceType: MercalysSourceType;
  businessPeriodStart: string;
  businessPeriodEnd: string;
  priorSourceDocumentIds: string[];
  rows: MercalysReconciliationRow[];
  counts: Record<ReconciliationCategory, number>;
  safeToApply: boolean;
  fingerprint: string;
}

interface ExistingObservation {
  id: string;
  sourceDocumentId: string;
  sourceRecordId: string;
  productId: string;
  productLabel: string;
  businessDate: string;
  values: ReconciliationValues;
}

export async function analyzeMercalysReconciliation(
  database: OutboxDatabase,
  storeId: string,
  summary: MercalysImportValidationSummary,
): Promise<MercalysReconciliation | null> {
  const existing = await loadExistingObservations(database, storeId, summary);
  if (existing.length === 0) return null;

  const rows = classifyRows(summary, existing);
  const counts = countCategories(rows);
  const result = {
    sourceType: summary.sourceType,
    businessPeriodStart: summary.businessPeriodStart,
    businessPeriodEnd: summary.businessPeriodEnd,
    priorSourceDocumentIds: [
      ...new Set(existing.map((row) => row.sourceDocumentId)),
    ].sort(),
    rows,
    counts,
    safeToApply:
      counts.AMBIGUOUS === 0 &&
      summary.productReviewCount === 0 &&
      summary.errorCount === 0,
  };
  return {
    ...result,
    fingerprint: reconciliationFingerprint(result),
  };
}

export function reconciliationFingerprint(input: {
  sourceType: MercalysSourceType;
  businessPeriodStart: string;
  businessPeriodEnd: string;
  rows: MercalysReconciliationRow[];
}) {
  return JSON.stringify({
    sourceType: input.sourceType,
    businessPeriodStart: input.businessPeriodStart,
    businessPeriodEnd: input.businessPeriodEnd,
    rows: input.rows.map((row) => ({
      key: row.key,
      category: row.category,
      incomingSourceIndex: row.incomingSourceIndex,
      existingObservationIds: row.existingObservationIds,
      existingValues: row.existingValues,
      incomingValues: row.incomingValues,
      reason: row.reason,
    })),
  });
}

function classifyRows(
  summary: MercalysImportValidationSummary,
  existing: ExistingObservation[],
) {
  const incomingByKey = new Map<string, MercalysImportValidationLine[]>();
  const unresolved: MercalysImportValidationLine[] = [];
  for (const line of summary.lines) {
    if (line.match.state !== "AUTO_MATCH" || !line.match.matchedProductId) {
      unresolved.push(line);
      continue;
    }
    const key = businessKey(
      line.match.matchedProductId,
      line.record.businessDate,
    );
    const values = incomingByKey.get(key) ?? [];
    values.push(line);
    incomingByKey.set(key, values);
  }

  const existingByKey = new Map<string, ExistingObservation[]>();
  for (const observation of existing) {
    const key = businessKey(observation.productId, observation.businessDate);
    const values = existingByKey.get(key) ?? [];
    values.push(observation);
    existingByKey.set(key, values);
  }

  const unresolvedDates = new Set(
    unresolved.map((line) => line.record.businessDate),
  );
  const keys = [
    ...new Set([...incomingByKey.keys(), ...existingByKey.keys()]),
  ].sort();
  const rows = keys.map((key): MercalysReconciliationRow => {
    const incoming = incomingByKey.get(key) ?? [];
    const prior = existingByKey.get(key) ?? [];
    const line = incoming[0];
    const observation = prior[0];
    const incomingValues = line ? valuesFromIncoming(summary, line) : null;
    const existingValues = observation?.values ?? null;
    const multipleIncoming = incoming.length > 1;
    const multipleExisting = prior.length > 1;
    const missingMayBeUnresolved =
      incoming.length === 0 &&
      observation !== undefined &&
      unresolvedDates.has(observation.businessDate);
    const category: ReconciliationCategory =
      multipleIncoming || multipleExisting || missingMayBeUnresolved
        ? "AMBIGUOUS"
        : incoming.length === 0
          ? "REMOVED"
          : prior.length === 0
            ? "ADDED"
            : valuesEqual(existingValues, incomingValues)
              ? "UNCHANGED"
              : "MODIFIED";
    return {
      key,
      category,
      productId: line?.match.matchedProductId ?? observation?.productId ?? null,
      productLabel: line?.record.rawLabel ?? observation?.productLabel ?? key,
      businessDate:
        line?.record.businessDate ?? observation?.businessDate ?? "",
      incomingSourceIndex: line?.record.sourceIndex ?? null,
      incomingRecord: line?.record ?? null,
      existingObservationIds: prior.map((item) => item.id).sort(),
      existingSourceRecordIds: prior.map((item) => item.sourceRecordId).sort(),
      existingValues,
      incomingValues,
      reason: multipleIncoming
        ? "MULTIPLE_INCOMING_ROWS"
        : multipleExisting
          ? "MULTIPLE_EXISTING_ROWS"
          : missingMayBeUnresolved
            ? "UNRESOLVED_ROW_ON_DATE"
            : null,
    };
  });

  rows.push(
    ...unresolved.map((line): MercalysReconciliationRow => ({
      key: `unresolved:${line.record.sourceIndex}`,
      category: "AMBIGUOUS",
      productId: null,
      productLabel: line.record.rawLabel,
      businessDate: line.record.businessDate,
      incomingSourceIndex: line.record.sourceIndex,
      incomingRecord: line.record,
      existingObservationIds: [],
      existingSourceRecordIds: [],
      existingValues: null,
      incomingValues: valuesFromIncoming(summary, line),
      reason: "UNRESOLVED_PRODUCT",
    })),
  );
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}

async function loadExistingObservations(
  database: OutboxDatabase,
  storeId: string,
  summary: MercalysImportValidationSummary,
): Promise<ExistingObservation[]> {
  if (summary.sourceType === "MERCALYS_SALES") {
    const rows = await database.getAllAsync<SalesObservationRow>(
      `
        SELECT o.id, o.source_document_id, o.source_record_id, o.product_id,
               p.label AS product_label, o.business_date, o.quantity,
               o.purchase_value, o.rce_value, o.sales_value, o.vat_value,
               o.margin_value, o.margin_rate
        FROM sales_observations o
        JOIN products p ON p.id = o.product_id
        JOIN source_documents d ON d.id = o.source_document_id
        WHERE o.store_id = ? AND o.business_date BETWEEN ? AND ?
          AND o.deleted_at IS NULL AND d.deleted_at IS NULL
          AND d.source_type = 'MERCALYS_SALES'
          AND d.local_processing_status = 'PUBLISHED'
        ORDER BY o.business_date, o.product_id, o.id
      `,
      storeId,
      summary.businessPeriodStart,
      summary.businessPeriodEnd,
    );
    return rows.map((row) => ({
      id: row.id,
      sourceDocumentId: row.source_document_id,
      sourceRecordId: row.source_record_id,
      productId: row.product_id,
      productLabel: row.product_label,
      businessDate: row.business_date,
      values: {
        quantity: row.quantity,
        purchaseValue: row.purchase_value,
        rceValue: row.rce_value,
        salesValue: row.sales_value,
        vatValue: row.vat_value,
        marginValue: row.margin_value,
        marginRate: row.margin_rate,
      },
    }));
  }

  const rows = await database.getAllAsync<WasteObservationRow>(
    `
      SELECT o.id, o.source_document_id, o.source_record_id, o.product_id,
             p.label AS product_label, o.business_date, o.quantity,
             o.purchase_value_known, o.sales_value
      FROM waste_observations o
      JOIN products p ON p.id = o.product_id
      JOIN source_documents d ON d.id = o.source_document_id
      WHERE o.store_id = ? AND o.business_date BETWEEN ? AND ?
        AND o.deleted_at IS NULL AND d.deleted_at IS NULL
        AND d.source_type = 'MERCALYS_WASTE'
        AND d.local_processing_status = 'PUBLISHED'
      ORDER BY o.business_date, o.product_id, o.id
    `,
    storeId,
    summary.businessPeriodStart,
    summary.businessPeriodEnd,
  );
  return rows.map((row) => ({
    id: row.id,
    sourceDocumentId: row.source_document_id,
    sourceRecordId: row.source_record_id,
    productId: row.product_id,
    productLabel: row.product_label,
    businessDate: row.business_date,
    values: {
      quantity: row.quantity,
      purchaseValue: row.purchase_value_known,
      rceValue: null,
      salesValue: row.sales_value,
      vatValue: null,
      marginValue: null,
      marginRate: null,
    },
  }));
}

function valuesFromIncoming(
  summary: MercalysImportValidationSummary,
  line: MercalysImportValidationLine,
): ReconciliationValues {
  const record = line.record;
  return {
    quantity: decimal(record.quantity),
    purchaseValue: nullableDecimal(record.purchaseValue),
    rceValue:
      summary.sourceType === "MERCALYS_SALES"
        ? nullableDecimal(record.rceValue)
        : null,
    salesValue: nullableDecimal(record.salesValue),
    vatValue:
      summary.sourceType === "MERCALYS_SALES"
        ? nullableDecimal(record.vatValue)
        : null,
    marginValue:
      summary.sourceType === "MERCALYS_SALES"
        ? nullableDecimal(record.marginValue)
        : null,
    marginRate:
      summary.sourceType === "MERCALYS_SALES"
        ? nullableDecimal(record.marginRate)
        : null,
  };
}

function valuesEqual(
  existing: ReconciliationValues | null,
  incoming: ReconciliationValues | null,
) {
  return JSON.stringify(existing) === JSON.stringify(incoming);
}

function businessKey(productId: string, businessDate: string) {
  return `${businessDate}:${productId}`;
}

function decimal(value: number) {
  return String(value);
}

function nullableDecimal(value: number | null) {
  return value === null ? null : decimal(value);
}

function countCategories(rows: MercalysReconciliationRow[]) {
  const counts: Record<ReconciliationCategory, number> = {
    UNCHANGED: 0,
    ADDED: 0,
    REMOVED: 0,
    MODIFIED: 0,
    AMBIGUOUS: 0,
  };
  for (const row of rows) counts[row.category] += 1;
  return counts;
}

interface BaseObservationRow {
  id: string;
  source_document_id: string;
  source_record_id: string;
  product_id: string;
  product_label: string;
  business_date: string;
  quantity: string | null;
  sales_value: string | null;
}

interface SalesObservationRow extends BaseObservationRow {
  quantity: string;
  purchase_value: string | null;
  rce_value: string | null;
  vat_value: string | null;
  margin_value: string | null;
  margin_rate: string | null;
}

interface WasteObservationRow extends BaseObservationRow {
  purchase_value_known: string | null;
}
