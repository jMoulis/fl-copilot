import {
  prepareStoreProductEvent,
  type ProductSubstitution,
} from "@fl-copilot/domain";
import type { EvidenceSales, EvidenceContext } from "./evidence";
let sequence = 0;
const uuid = () =>
  `${(++sequence).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const hashes = new Map<string, string>();
export const evidenceDigest = async (s: string) => {
  if (!hashes.has(s))
    hashes.set(
      s,
      (hashes.size + 1).toString(16).padStart(12, "0").padEnd(64, "0"),
    );
  return hashes.get(s)!;
};
export async function evidenceFixture() {
  const storeId = uuid(),
    product = { id: uuid(), storeId, status: "ACTIVE" },
    substitute = { id: uuid(), storeId, status: "ACTIVE" },
    need = { id: uuid(), storeId, status: "ACTIVE" },
    at = "2026-10-10T10:00:00.000Z";
  const substitution: ProductSubstitution = {
    id: uuid(),
    storeId,
    sourceProductId: product.id,
    substituteProductId: substitute.id,
    needUnitId: need.id,
    needCompatibility: 0.8,
    usageCompatibility: 0.7,
    priceCompatibility: null,
    packagingCompatibility: null,
    observedSubstitution: null,
    relationshipScore: null,
    confidence: null,
    evidenceCount: 0,
    lastEvidenceAt: null,
    source: "MANUAL",
    status: "VALIDATED",
    humanConfirmed: true,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  const event = prepareStoreProductEvent(storeId, {
    event: {
      id: uuid(),
      productId: product.id,
      type: "OUT_OF_STOCK",
      startedAt: "2026-10-08T22:00:00Z",
      endedAt: "2026-10-09T22:00:00Z",
      clientCapturedAt: at,
    },
  });
  const sale = (
    date: string,
    value: string | null,
    productId = substitute.id,
  ): EvidenceSales => ({
    id: uuid(),
    storeId,
    productId,
    date,
    salesValue: value,
    sourceRecordId: uuid(),
    version: 1,
    updatedAt: at,
  });
  const context: EvidenceContext = {
    operations: [],
    sourceIds: [],
    holidayDates: [],
    schoolHolidayDates: [],
    publicHolidayCoverage: "UNKNOWN",
    schoolHolidayCoverage: "UNKNOWN",
  };
  const input = {
    event,
    relation: substitution,
    source: product,
    candidate: substitute,
    need,
    events: [event],
    sales: [
      sale("2026-10-09", "135"),
      sale("2026-10-02", "100"),
      sale("2026-09-25", "100"),
      sale("2026-09-18", "100"),
      sale("2026-09-11", "100"),
    ],
    context,
    now: "2026-10-10T12:00:00.000Z",
    digest: evidenceDigest,
  };
  return { product, substitute, need, substitution, event, sale, input };
}
