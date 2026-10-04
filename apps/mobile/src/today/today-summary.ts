import {
  addDecimals,
  buildDataQualityResult,
  compareJMinus7,
  createExplicitQualityComponent,
  generateInitialAnalyticalCandidates,
  parseDecimal,
  type AnalyticalCandidate,
  type ComparisonResult,
  type DepartmentDailyPerformance,
  type DatedKpiValue,
  type FormulaStatus,
  type InitialCandidateThresholds,
  type ProductDailyPerformance,
} from "@fl-copilot/analytics-core";

export interface TodayDatabase {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export interface TodayKpi {
  readonly id: "sales" | "margin" | "waste";
  readonly label: string;
  readonly value: string | null;
  readonly status: FormulaStatus;
  readonly comparison: ComparisonResult;
}

export interface TodayPriority {
  readonly id: string;
  readonly rank: number;
  readonly type: AnalyticalCandidate["type"];
  readonly productId: string;
  readonly productLabel: string;
  readonly currentValue: string | null;
  readonly referenceValue: string | null;
  readonly absoluteDifference: string | null;
  readonly percentageDifference: string | null;
  readonly dataQualityScore: number;
  readonly status: AnalyticalCandidate["status"];
  readonly incompleteMetricLabels: readonly string[];
}

export interface TodayMovement {
  readonly id: string;
  readonly productId: string;
  readonly productLabel: string;
  readonly metric: "SALES" | "MARGIN" | "WASTE";
  readonly absoluteDifference: string;
  readonly percentageDifference: string | null;
}

export interface TodayDataQuality {
  readonly unresolvedProductCount: number;
  readonly incompleteKpiLabels: readonly string[];
  readonly alertMessage: string | null;
}

export interface TodaySummary {
  readonly businessDate: string;
  readonly computedAt: string;
  readonly origin: "LOCAL" | "REMOTE";
  readonly productCount: number;
  readonly kpis: readonly TodayKpi[];
  readonly priorities: readonly TodayPriority[];
  readonly movements: readonly TodayMovement[];
  readonly tensions: readonly never[];
  readonly dataQuality: TodayDataQuality;
}

interface DepartmentRow {
  readonly payload_json: string;
  readonly origin: string;
}

interface ProductPerformanceRow {
  readonly product_id: string;
  readonly label: string;
  readonly payload_json: string;
}

const thresholds: InitialCandidateThresholds = {
  wasteSpike: {
    minimumAbsoluteChange: "10",
    fullScaleAbsoluteChange: "40",
    minimumPercentageChange: "20",
    fullScalePercentageChange: "80",
    urgencyScore: 0.8,
    minimumDataQualityScore: 0.7,
  },
  salesDrop: {
    minimumAbsoluteChange: "50",
    fullScaleAbsoluteChange: "200",
    minimumPercentageChange: "10",
    fullScalePercentageChange: "40",
    urgencyScore: 0.7,
    minimumDataQualityScore: 0.7,
  },
  marginDrop: {
    minimumAbsoluteChange: "20",
    fullScaleAbsoluteChange: "100",
    minimumPercentageChange: "10",
    fullScalePercentageChange: "40",
    urgencyScore: 0.6,
    minimumDataQualityScore: 0.7,
  },
  dataQualityAlertScore: 0.5,
};

export class TodaySummaryRepository {
  constructor(private readonly database: TodayDatabase) {}

  async load(storeId: string): Promise<TodaySummary | null> {
    const latest = await this.database.getFirstAsync<DepartmentRow>(
      `
        SELECT payload_json, origin
        FROM department_daily_performance
        WHERE store_id = ?
        ORDER BY business_date DESC
        LIMIT 1
      `,
      storeId,
    );
    if (!latest) return null;

    const department = parseDepartment(latest.payload_json, storeId);
    const referenceDate = addUtcDays(department.date, -7);
    const [referenceRow, currentRows, referenceRows, unresolved] =
      await Promise.all([
        this.database.getFirstAsync<DepartmentRow>(
          `
            SELECT payload_json, origin
            FROM department_daily_performance
            WHERE store_id = ? AND business_date = ?
            LIMIT 1
          `,
          storeId,
          referenceDate,
        ),
        this.loadProductRows(storeId, department.date),
        this.loadProductRows(storeId, referenceDate),
        this.database.getFirstAsync<{ unresolved_count: number }>(
          `
            SELECT COUNT(*) AS unresolved_count
            FROM source_records
            WHERE store_id = ? AND status = 'WARNING'
              AND deleted_at IS NULL
              AND json_extract(normalized_payload_json, '$.businessDate') = ?
          `,
          storeId,
          department.date,
        ),
      ]);
    const referenceDepartment = referenceRow
      ? parseDepartment(referenceRow.payload_json, storeId)
      : null;
    const currentProducts = parseProducts(
      currentRows,
      storeId,
      department.date,
    );
    const referenceProducts = new Map(
      parseProducts(referenceRows, storeId, referenceDate).map((item) => [
        item.performance.productId,
        item.performance,
      ]),
    );
    const kpis = buildDepartmentKpis(department, referenceDepartment);
    const { priorities, movements } = buildProductSignals(
      currentProducts,
      referenceProducts,
      department.computedAt,
    );
    const unresolvedProductCount = Number(unresolved?.unresolved_count ?? 0);

    return {
      businessDate: department.date,
      computedAt: department.computedAt,
      origin: latest.origin === "REMOTE" ? "REMOTE" : "LOCAL",
      productCount: department.productCount,
      kpis,
      priorities,
      movements,
      tensions: [],
      dataQuality: buildTodayDataQuality(kpis, unresolvedProductCount),
    };
  }

  private loadProductRows(storeId: string, businessDate: string) {
    return this.database.getAllAsync<ProductPerformanceRow>(
      `
        SELECT d.product_id, p.label, d.payload_json
        FROM product_daily_performance d
        JOIN products p ON p.id = d.product_id AND p.store_id = d.store_id
        WHERE d.store_id = ? AND d.business_date = ?
          AND p.deleted_at IS NULL
        ORDER BY d.product_id
      `,
      storeId,
      businessDate,
    );
  }
}

function buildDepartmentKpis(
  current: DepartmentDailyPerformance,
  reference: DepartmentDailyPerformance | null,
): readonly TodayKpi[] {
  return [
    departmentKpi(
      "sales",
      "Ventes",
      current,
      reference,
      (performance) => performance.sales.salesValue,
      (performance) => performance.availability.salesValue.status,
    ),
    departmentKpi(
      "margin",
      "Marge",
      current,
      reference,
      (performance) => performance.sales.marginValue,
      (performance) => performance.availability.salesMarginValue.status,
    ),
    departmentKpi(
      "waste",
      "Casse au PA",
      current,
      reference,
      departmentWasteCost,
      departmentWasteStatus,
    ),
  ];
}

function departmentKpi(
  id: TodayKpi["id"],
  label: string,
  current: DepartmentDailyPerformance,
  reference: DepartmentDailyPerformance | null,
  value: (performance: DepartmentDailyPerformance) => string | null,
  status: (performance: DepartmentDailyPerformance) => FormulaStatus,
): TodayKpi {
  const currentPoint = point(
    current.date,
    value(current),
    status(current),
    current.sourceLineageIds,
  );
  const history = reference
    ? [
        point(
          reference.date,
          value(reference),
          status(reference),
          reference.sourceLineageIds,
        ),
      ]
    : [];
  return {
    id,
    label,
    value: currentPoint.value,
    status: currentPoint.status,
    comparison: compareJMinus7({
      kpiId: `${id}_value`,
      current: currentPoint,
      history,
    }),
  };
}

function buildProductSignals(
  currentProducts: readonly {
    label: string;
    performance: ProductDailyPerformance;
  }[],
  referenceProducts: ReadonlyMap<string, ProductDailyPerformance>,
  generatedAt: string,
) {
  const candidates: {
    candidate: AnalyticalCandidate;
    productLabel: string;
    incompleteMetricLabels: readonly string[];
  }[] = [];
  const movements: TodayMovement[] = [];

  for (const current of currentProducts) {
    const reference = referenceProducts.get(current.performance.productId);
    const comparisons = {
      sales: productComparison(
        "sales_value",
        current.performance,
        reference,
        (performance) => performance.sales.salesValue,
        (performance) => performance.availability.salesValue.status,
      ),
      margin: productComparison(
        "margin_value",
        current.performance,
        reference,
        (performance) => performance.sales.marginValue,
        (performance) => performance.availability.salesMarginValue.status,
      ),
      waste: productComparison(
        "waste_purchase_value",
        current.performance,
        reference,
        productWasteCost,
        productWasteStatus,
      ),
    };
    const quality = buildDataQualityResult({
      components: [
        createExplicitQualityComponent(
          "sourceCompleteness",
          productQualityScore(current.performance),
        ),
      ],
      sourceLineageIds: current.performance.sourceLineageIds,
    });
    for (const candidate of generateInitialAnalyticalCandidates({
      storeId: current.performance.storeId,
      businessDate: current.performance.date,
      entityType: "PRODUCT",
      entityId: current.performance.productId,
      comparisons,
      dataQuality: quality,
      thresholds,
      generatedAt,
    })) {
      candidates.push({
        candidate,
        productLabel: current.label,
        incompleteMetricLabels: incompleteProductMetricLabels(
          current.performance,
        ),
      });
    }
    movements.push(
      ...movementFromComparison(current, "SALES", comparisons.sales),
      ...movementFromComparison(current, "MARGIN", comparisons.margin),
      ...movementFromComparison(current, "WASTE", comparisons.waste),
    );
  }

  const priorities = candidates
    .sort(compareRankedCandidates)
    .slice(0, 3)
    .map(
      (
        { candidate, productLabel, incompleteMetricLabels },
        index,
      ): TodayPriority => ({
        id: candidate.id,
        rank: index + 1,
        type: candidate.type,
        productId: candidate.entityId,
        productLabel,
        currentValue: evidenceValue(candidate, "CURRENT_VALUE"),
        referenceValue: evidenceValue(candidate, "REFERENCE_VALUE"),
        absoluteDifference: evidenceValue(candidate, "ABSOLUTE_DIFFERENCE"),
        percentageDifference: evidenceValue(candidate, "PERCENTAGE_DIFFERENCE"),
        dataQualityScore: candidate.dataQualityScore,
        status: candidate.status,
        incompleteMetricLabels,
      }),
    );
  return {
    priorities,
    movements: movements.sort(compareMovements).slice(0, 5),
  };
}

function productComparison(
  kpiId: string,
  current: ProductDailyPerformance,
  reference: ProductDailyPerformance | undefined,
  value: (performance: ProductDailyPerformance) => string | null,
  status: (performance: ProductDailyPerformance) => FormulaStatus,
) {
  return compareJMinus7({
    kpiId,
    current: point(
      current.date,
      value(current),
      status(current),
      current.sourceLineageIds,
    ),
    history: reference
      ? [
          point(
            reference.date,
            value(reference),
            status(reference),
            reference.sourceLineageIds,
          ),
        ]
      : [],
  });
}

function movementFromComparison(
  current: { label: string; performance: ProductDailyPerformance },
  metric: TodayMovement["metric"],
  comparison: ComparisonResult,
): readonly TodayMovement[] {
  return comparison.absoluteDifference === null ||
    parseDecimal(comparison.absoluteDifference).value.isZero()
    ? []
    : [
        {
          id: `${current.performance.productId}:${metric}`,
          productId: current.performance.productId,
          productLabel: current.label,
          metric,
          absoluteDifference: comparison.absoluteDifference,
          percentageDifference: comparison.percentageDifference,
        },
      ];
}

function buildTodayDataQuality(
  kpis: readonly TodayKpi[],
  unresolvedProductCount: number,
): TodayDataQuality {
  const incompleteKpiLabels = kpis
    .filter((kpi) => kpi.status !== "AVAILABLE")
    .map((kpi) => kpi.label);
  const messages: string[] = [];
  if (unresolvedProductCount > 0) {
    messages.push(
      `${unresolvedProductCount} produit${unresolvedProductCount > 1 ? "s" : ""} reste${unresolvedProductCount > 1 ? "nt" : ""} à confirmer pour cette journée.`,
    );
  }
  if (incompleteKpiLabels.length > 0) {
    messages.push(
      `${incompleteKpiLabels.join(", ")} : données incomplètes ou indisponibles.`,
    );
  }
  return {
    unresolvedProductCount,
    incompleteKpiLabels,
    alertMessage: messages.length > 0 ? messages.join(" ") : null,
  };
}

function parseDepartment(value: string, expectedStoreId: string) {
  const performance = JSON.parse(value) as DepartmentDailyPerformance;
  if (performance.storeId !== expectedStoreId) {
    throw new Error("Department performance belongs to another store.");
  }
  return performance;
}

function parseProducts(
  rows: readonly ProductPerformanceRow[],
  expectedStoreId: string,
  expectedDate: string,
) {
  return rows.map((row) => {
    const performance = JSON.parse(row.payload_json) as ProductDailyPerformance;
    if (
      performance.storeId !== expectedStoreId ||
      performance.productId !== row.product_id ||
      performance.date !== expectedDate
    ) {
      throw new Error("Product performance is outside the Today perimeter.");
    }
    return { label: row.label, performance };
  });
}

function point(
  businessDate: string,
  value: string | null,
  status: FormulaStatus,
  sourceLineageIds: readonly string[],
): DatedKpiValue {
  return { businessDate, value, status, sourceLineageIds };
}

function departmentWasteCost(performance: DepartmentDailyPerformance) {
  return sumPresent([
    performance.waste.purchaseValueKnown,
    performance.waste.purchaseValueEstimated,
  ]);
}

function productWasteCost(performance: ProductDailyPerformance) {
  return sumPresent([
    performance.waste.purchaseValueKnown,
    performance.waste.purchaseValueEstimated,
  ]);
}

function departmentWasteStatus(
  performance: DepartmentDailyPerformance,
): FormulaStatus {
  return combinedWasteStatus(
    performance.waste.purchaseValueKnown,
    performance.availability.wastePurchaseValueKnown.status,
    performance.waste.purchaseValueEstimated,
    performance.availability.wastePurchaseValueEstimated.status,
  );
}

function productWasteStatus(
  performance: ProductDailyPerformance,
): FormulaStatus {
  return combinedWasteStatus(
    performance.waste.purchaseValueKnown,
    performance.availability.wastePurchaseValueKnown.status,
    performance.waste.purchaseValueEstimated,
    performance.availability.wastePurchaseValueEstimated.status,
  );
}

function sumPresent(values: readonly (string | null)[]) {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : addDecimals(present);
}

function combinedWasteStatus(
  knownValue: string | null,
  knownStatus: FormulaStatus,
  estimatedValue: string | null,
  estimatedStatus: FormulaStatus,
): FormulaStatus {
  if (knownValue === null && estimatedValue === null) return "UNAVAILABLE";
  if (
    knownValue !== null &&
    knownStatus === "AVAILABLE" &&
    estimatedValue === null
  ) {
    return "AVAILABLE";
  }
  return knownStatus === "AVAILABLE" && estimatedStatus === "AVAILABLE"
    ? "AVAILABLE"
    : "PARTIAL";
}

function productQualityScore(performance: ProductDailyPerformance) {
  const statuses = [
    performance.availability.salesValue.status,
    performance.availability.salesMarginValue.status,
    productWasteStatus(performance),
  ];
  const score =
    statuses.reduce(
      (sum, status) =>
        sum + (status === "AVAILABLE" ? 1 : status === "PARTIAL" ? 0.5 : 0),
      0,
    ) / statuses.length;
  return score.toFixed(4);
}

function incompleteProductMetricLabels(
  performance: ProductDailyPerformance,
): readonly string[] {
  return [
    ["Ventes", performance.availability.salesValue.status],
    ["Marge", performance.availability.salesMarginValue.status],
    ["Casse au PA", productWasteStatus(performance)],
  ]
    .filter(([, status]) => status !== "AVAILABLE")
    .map(([label]) => label);
}

function evidenceValue(candidate: AnalyticalCandidate, label: string) {
  const value = candidate.evidence.find((item) => item.label === label)?.value;
  return typeof value === "string" ? value : null;
}

function compareRankedCandidates(
  left: { candidate: AnalyticalCandidate },
  right: { candidate: AnalyticalCandidate },
) {
  return (
    right.candidate.economicImpactScore - left.candidate.economicImpactScore ||
    right.candidate.urgencyScore - left.candidate.urgencyScore ||
    right.candidate.deviationScore - left.candidate.deviationScore ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

function compareMovements(left: TodayMovement, right: TodayMovement) {
  const magnitude = (movement: TodayMovement) =>
    parseDecimal(movement.absoluteDifference).value.abs();
  return (
    magnitude(right).comparedTo(magnitude(left)) ||
    left.id.localeCompare(right.id)
  );
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid business date.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
