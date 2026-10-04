const STORE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const BUSINESS_DATE = "2026-09-26";
const CREATED_AT = "2026-09-27T08:00:00.000Z";

function metadata(
  id: string,
  sourceDocumentId: string,
  sourceRecordId: string,
) {
  return {
    id,
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    businessDate: BUSINESS_DATE,
    sourceDocumentId,
    sourceRecordId,
    validationStatus: "VALIDATED" as const,
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    syncState: "PENDING" as const,
    remoteVersion: null,
    dirty: true as const,
  };
}

export const productDailyGoldenFixture = {
  product: {
    id: PRODUCT_ID,
    storeId: STORE_ID,
    label: "POIRE CONFERENCE VRAC",
    category: "FRUIT" as const,
    nature: "BULK" as const,
    salesUnit: "KG" as const,
    packaging: null,
    familyId: null,
    subfamilyId: null,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  },
  businessDate: BUSINESS_DATE,
  salesObservations: [
    {
      ...metadata(
        "44444444-4444-4444-8444-444444444441",
        "33333333-3333-4333-8333-333333333331",
        "55555555-5555-4555-8555-555555555551",
      ),
      quantity: "10.500",
      purchaseValue: "25.00",
      rceValue: null,
      salesValue: "42.00",
      vatValue: "2.10",
      marginValue: "17.00",
      marginRate: "0.4048",
    },
    {
      ...metadata(
        "44444444-4444-4444-8444-444444444442",
        "33333333-3333-4333-8333-333333333332",
        "55555555-5555-4555-8555-555555555552",
      ),
      quantity: "4.25",
      purchaseValue: null,
      rceValue: null,
      salesValue: "18.50",
      vatValue: "0.93",
      marginValue: null,
      marginRate: "0.3514",
    },
  ],
  wasteObservations: [
    {
      ...metadata(
        "66666666-6666-4666-8666-666666666661",
        "33333333-3333-4333-8333-333333333333",
        "77777777-7777-4777-8777-777777777771",
      ),
      productNature: "BULK" as const,
      quantity: "0.580",
      purchaseValueKnown: "2.50",
      purchaseValueEstimated: null,
      salesValue: "4.00",
      costQuality: "KNOWN" as const,
      sourceType: "MERCALYS" as const,
    },
    {
      ...metadata(
        "66666666-6666-4666-8666-666666666662",
        "33333333-3333-4333-8333-333333333334",
        "77777777-7777-4777-8777-777777777772",
      ),
      productNature: "BULK" as const,
      quantity: "0.20",
      purchaseValueKnown: null,
      purchaseValueEstimated: "0.80",
      salesValue: "1.20",
      costQuality: "ESTIMATED" as const,
      sourceType: "WASTE_RECEIPT" as const,
    },
  ],
  commercialOperationIds: [
    "99999999-9999-4999-8999-999999999992",
    "99999999-9999-4999-8999-999999999991",
  ],
  merchandisingPlanIds: [],
  contextEventIds: [],
  marketSignalIds: [],
  storeProductEventIds: [],
  weatherRecordId: null,
  computedAt: "2026-09-27T09:00:00.000Z",
} as const;
