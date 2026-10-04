export type KpiCategory =
  | "SALES"
  | "MARGIN"
  | "WASTE"
  | "PROMOTION"
  | "SUBSTITUTION"
  | "DATA_QUALITY"
  | "EXECUTION"
  | "CONTEXT";

export type KpiUnit =
  | "CURRENCY"
  | "PERCENT"
  | "SALES_UNIT"
  | "CURRENCY_PER_SALES_UNIT"
  | "COUNT"
  | "INDEX"
  | "NONE";

export type KpiAggregationMethod =
  | "SUM"
  | "WEIGHTED"
  | "RATIO_OF_SUMS"
  | "AVERAGE"
  | "MEDIAN"
  | "LAST_VALUE"
  | "CUSTOM";

export interface KpiDefinition {
  readonly id: string;
  readonly name: string;
  readonly frenchLabel: string;
  readonly description: string;
  readonly businessQuestion: string;
  readonly category: KpiCategory;
  readonly formulaId: string;
  readonly unit: KpiUnit;
  readonly aggregationMethod: KpiAggregationMethod;
  readonly supportedDimensions: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly missingDataPolicy: string;
  readonly qualityRequirements: readonly string[];
  readonly sourceType: "SOURCE" | "DERIVED";
  readonly status: "ACTIVE" | "EXPERIMENTAL" | "DISABLED";
}

const COMMON_DIMENSIONS = [
  "store",
  "date",
  "product",
  "category",
  "family",
  "subfamily",
] as const;

export const KPI_REGISTRY = [
  {
    id: "sales_value",
    name: "Sales value",
    frenchLabel: "Ventes",
    description: "Sum of validated Mercalys sales values.",
    businessQuestion: "What sales value was observed?",
    category: "SALES",
    formulaId: "sum_available_currency",
    unit: "CURRENCY",
    aggregationMethod: "SUM",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: ["SalesObservation.salesValue"],
    missingDataPolicy:
      "Unavailable when every sales value is missing; partial when only some values are present.",
    qualityRequirements: ["validated sales observations"],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "sold_quantity",
    name: "Sold quantity",
    frenchLabel: "Quantité vendue",
    description:
      "Sum of sold quantities when every contributing sales unit is compatible.",
    businessQuestion: "How much product was sold in one compatible unit?",
    category: "SALES",
    formulaId: "sum_compatible_quantity",
    unit: "SALES_UNIT",
    aggregationMethod: "SUM",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: ["SalesObservation.quantity", "Product.salesUnit"],
    missingDataPolicy:
      "Unavailable for mixed or unknown units and when every quantity is missing.",
    qualityRequirements: [
      "validated sales observations",
      "compatible known sales units",
    ],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "sales_purchase_value",
    name: "Sales purchase value",
    frenchLabel: "Coût d’achat des ventes",
    description: "Sum of source purchase values for sold goods.",
    businessQuestion: "What source purchase value is attached to sold goods?",
    category: "MARGIN",
    formulaId: "sum_available_currency",
    unit: "CURRENCY",
    aggregationMethod: "SUM",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: ["SalesObservation.purchaseValue"],
    missingDataPolicy:
      "Unavailable when every purchase value is missing; partial when coverage is incomplete.",
    qualityRequirements: ["validated sales observations"],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "source_margin_value",
    name: "Source margin value",
    frenchLabel: "Marge",
    description: "Sum of margin values preserved from the Mercalys source.",
    businessQuestion: "What source margin value was reported?",
    category: "MARGIN",
    formulaId: "sum_available_currency",
    unit: "CURRENCY",
    aggregationMethod: "SUM",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: ["SalesObservation.marginValue"],
    missingDataPolicy:
      "Unavailable when every source margin value is missing; partial when coverage is incomplete.",
    qualityRequirements: [
      "validated sales observations",
      "source margin semantics retained",
    ],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "source_margin_rate",
    name: "Source margin rate",
    frenchLabel: "Taux de marge",
    description:
      "Aggregate source margin rate reserved until its business denominator is validated.",
    businessQuestion:
      "What aggregate source margin rate is valid for this perimeter?",
    category: "MARGIN",
    formulaId: "validated_ratio_of_sums",
    unit: "PERCENT",
    aggregationMethod: "RATIO_OF_SUMS",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: [
      "SalesObservation.marginValue",
      "validated margin denominator",
    ],
    missingDataPolicy:
      "Unavailable until the aggregate source formula is validated.",
    qualityRequirements: ["validated aggregate margin semantics"],
    sourceType: "DERIVED",
    status: "DISABLED",
  },
  {
    id: "average_realized_price",
    name: "Average realized price",
    frenchLabel: "Prix moyen réalisé",
    description:
      "Sales value divided by a positive sold quantity in one compatible unit.",
    businessQuestion:
      "What selling value was realized per compatible sales unit?",
    category: "SALES",
    formulaId: "sales_value_over_sold_quantity",
    unit: "CURRENCY_PER_SALES_UNIT",
    aggregationMethod: "RATIO_OF_SUMS",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: [
      "SalesObservation.salesValue",
      "SalesObservation.quantity",
      "Product.salesUnit",
    ],
    missingDataPolicy:
      "Unavailable for missing values, non-positive quantity, mixed units or unknown units.",
    qualityRequirements: [
      "validated sales observations",
      "compatible known sales units",
    ],
    sourceType: "DERIVED",
    status: "ACTIVE",
  },
  {
    id: "waste_quantity",
    name: "Waste quantity",
    frenchLabel: "Quantité de casse",
    description: "Sum of validated waste quantities in one compatible unit.",
    businessQuestion: "How much waste was recorded in one compatible unit?",
    category: "WASTE",
    formulaId: "sum_compatible_quantity",
    unit: "SALES_UNIT",
    aggregationMethod: "SUM",
    supportedDimensions: [...COMMON_DIMENSIONS, "productNature", "wasteSource"],
    requiredInputs: ["WasteObservation.quantity", "Product.salesUnit"],
    missingDataPolicy:
      "Unavailable for mixed or unknown units and when every quantity is missing.",
    qualityRequirements: [
      "validated reconciled waste observations",
      "compatible known sales units",
    ],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "waste_purchase_value_known",
    name: "Known purchase-cost waste",
    frenchLabel: "Casse au coût d’achat connu",
    description: "Sum of waste purchase values whose cost quality is known.",
    businessQuestion: "What waste purchase cost is known?",
    category: "WASTE",
    formulaId: "sum_known_waste_cost",
    unit: "CURRENCY",
    aggregationMethod: "SUM",
    supportedDimensions: [...COMMON_DIMENSIONS, "productNature", "wasteSource"],
    requiredInputs: [
      "WasteObservation.purchaseValueKnown",
      "WasteObservation.costQuality",
    ],
    missingDataPolicy:
      "Unavailable when no known purchase-cost value is present.",
    qualityRequirements: [
      "validated reconciled waste observations",
      "costQuality KNOWN",
    ],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "waste_purchase_value_estimated",
    name: "Estimated purchase-cost waste",
    frenchLabel: "Casse au coût d’achat estimé",
    description:
      "Sum of estimated waste purchase values, kept separate from known cost.",
    businessQuestion: "What waste purchase cost is estimated?",
    category: "WASTE",
    formulaId: "sum_estimated_waste_cost",
    unit: "CURRENCY",
    aggregationMethod: "SUM",
    supportedDimensions: [...COMMON_DIMENSIONS, "productNature", "wasteSource"],
    requiredInputs: [
      "WasteObservation.purchaseValueEstimated",
      "WasteObservation.costQuality",
    ],
    missingDataPolicy:
      "Unavailable when no estimated purchase-cost value is present.",
    qualityRequirements: [
      "validated reconciled waste observations",
      "costQuality ESTIMATED",
    ],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "waste_sales_value",
    name: "Waste selling value",
    frenchLabel: "Valeur de vente de la casse",
    description:
      "Selling-price value attached to waste; it is not realized sales revenue.",
    businessQuestion: "What selling-price value is attached to recorded waste?",
    category: "WASTE",
    formulaId: "sum_available_currency",
    unit: "CURRENCY",
    aggregationMethod: "SUM",
    supportedDimensions: [...COMMON_DIMENSIONS, "productNature", "wasteSource"],
    requiredInputs: ["WasteObservation.salesValue"],
    missingDataPolicy:
      "Unavailable when every waste selling value is missing; partial when coverage is incomplete.",
    qualityRequirements: ["validated reconciled waste observations"],
    sourceType: "SOURCE",
    status: "ACTIVE",
  },
  {
    id: "waste_purchase_cost_to_sales_value",
    name: "Waste purchase cost to sales value",
    frenchLabel: "Casse au coût d’achat / Ventes",
    description: "Known waste purchase cost divided by sales value.",
    businessQuestion:
      "What share of sales value is represented by known waste purchase cost?",
    category: "WASTE",
    formulaId: "known_waste_purchase_cost_over_sales_value",
    unit: "PERCENT",
    aggregationMethod: "RATIO_OF_SUMS",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: ["waste_purchase_value_known", "sales_value"],
    missingDataPolicy:
      "Unavailable when either input is missing or sales value is non-positive.",
    qualityRequirements: [
      "known waste cost",
      "validated sales value",
      "explicit cost coverage",
    ],
    sourceType: "DERIVED",
    status: "EXPERIMENTAL",
  },
  {
    id: "waste_sales_value_to_sales_value",
    name: "Waste selling value to sales value",
    frenchLabel: "Valeur de vente de la casse / Ventes",
    description:
      "Waste selling value divided by sales value, kept distinct from purchase-cost waste.",
    businessQuestion:
      "What share of sales value is represented by waste selling value?",
    category: "WASTE",
    formulaId: "waste_sales_value_over_sales_value",
    unit: "PERCENT",
    aggregationMethod: "RATIO_OF_SUMS",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: ["waste_sales_value", "sales_value"],
    missingDataPolicy:
      "Unavailable when either input is missing or sales value is non-positive.",
    qualityRequirements: [
      "validated waste selling value",
      "validated sales value",
    ],
    sourceType: "DERIVED",
    status: "ACTIVE",
  },
  {
    id: "waste_output_share",
    name: "Share of known outputs wasted",
    frenchLabel: "Part de la casse dans les sorties connues",
    description:
      "Waste quantity divided by sold quantity plus waste quantity in one compatible unit.",
    businessQuestion: "What share of known outputs was recorded as waste?",
    category: "WASTE",
    formulaId: "waste_quantity_over_known_outputs",
    unit: "PERCENT",
    aggregationMethod: "RATIO_OF_SUMS",
    supportedDimensions: COMMON_DIMENSIONS,
    requiredInputs: [
      "sold_quantity",
      "waste_quantity",
      "compatible sales unit",
    ],
    missingDataPolicy:
      "Unavailable when quantities are missing, units differ or total known output is non-positive.",
    qualityRequirements: [
      "compatible known sales units",
      "validated sales and waste observations",
    ],
    sourceType: "DERIVED",
    status: "ACTIVE",
  },
] as const satisfies readonly KpiDefinition[];

export type KpiId = (typeof KPI_REGISTRY)[number]["id"];

const KPI_BY_ID = new Map<string, KpiDefinition>(
  KPI_REGISTRY.map((definition) => [definition.id, definition]),
);

export function getKpiDefinition(id: string): KpiDefinition | undefined {
  return KPI_BY_ID.get(id);
}
