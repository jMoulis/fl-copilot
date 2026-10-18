import {
  receiptCorrectionInputSchema,
  receiptCorrectionPreviewSchema,
} from "../packages/domain/src/index";
import { receiptPublicationChatFixture } from "./test-receipt-publication-fixtures";
export function receiptCorrectionFixture(
  base = receiptPublicationChatFixture(),
) {
  const input = receiptCorrectionInputSchema.parse({
    sourceDocumentId: base.source.sourceDocumentId,
    patch: {
      wasteDate: "2026-10-09",
      cashierNumber: "000123",
      lines: [
        {
          lineId: base.p.lines[0]!.id,
          values: { weight: "2", totalPrice: "4" },
        },
      ],
    },
  });
  const preview = receiptCorrectionPreviewSchema.parse({
    ...base.preview,
    input,
  });
  return { ...base, input, preview };
}
