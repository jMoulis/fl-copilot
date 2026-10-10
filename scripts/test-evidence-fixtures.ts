import { randomUUID, createHash } from "node:crypto";
import { substitutionFixture } from "./test-substitution-fixtures";
import { prepareStoreProductEvent } from "../packages/domain/src/index";
import type {
  EvidenceSales,
  EvidenceContext,
} from "../packages/substitution-core/src/index";
export const evidenceDigest = async (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function evidenceFixture() {
  const f = await substitutionFixture(),
    event = prepareStoreProductEvent(f.need.storeId, {
      event: {
        id: randomUUID(),
        productId: f.product.id,
        type: "OUT_OF_STOCK",
        startedAt: "2026-10-08T22:00:00Z",
        endedAt: "2026-10-09T22:00:00Z",
        clientCapturedAt: "2026-10-10T10:00:00Z",
      },
    });
  const sale = (
    date: string,
    value: string | null,
    product = f.substitute.id,
  ): EvidenceSales => ({
    id: randomUUID(),
    storeId: f.need.storeId,
    productId: product,
    date,
    salesValue: value,
    sourceRecordId: randomUUID(),
    version: 1,
    updatedAt: "2026-10-10T10:00:00Z",
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
    relation: f.substitution,
    source: f.product,
    candidate: f.substitute,
    need: f.need,
    events: [event],
    sales: [
      sale("2026-10-09", "135"),
      sale("2026-10-02", "100"),
      sale("2026-09-25", "100"),
      sale("2026-09-18", "100"),
      sale("2026-09-11", "100"),
    ],
    context,
    now: "2026-10-10T12:00:00Z",
    digest: evidenceDigest,
  };
  return { ...f, event, sale, input };
}
