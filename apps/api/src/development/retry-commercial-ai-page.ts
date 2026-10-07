import { z } from "zod";
import { parseEnvironment } from "../config.js";
import { createMongoDatabase } from "../database/mongo.js";
import { createCommercialAiDraftProcessor } from "../commercial/ai-draft-processing.js";
import { createCommercialAiProvider } from "../commercial/ai-provider.js";

// Maintenance command, not an automatic revival of schema-invalid model output.
if (process.env.CONFIRM_COMMERCIAL_AI_RETRY !== "OUTPUT_TRUNCATION")
  throw new Error("Confirm the truncated response before retrying this page.");
const [storeId, sourceDocumentId, page] = process.argv.slice(2);
const input = z
  .object({
    storeId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    pageNumber: z.coerce.number().int().min(1).max(100),
  })
  .parse({ storeId, sourceDocumentId, pageNumber: page });
const config = parseEnvironment(process.env);
const database = createMongoDatabase(config);
try {
  const provider = createCommercialAiProvider({
    model: config.COMMERCIAL_PDF_AI_MODEL,
  });
  await createCommercialAiDraftProcessor(database, provider).retryTruncatedPage(
    input.storeId,
    input.sourceDocumentId,
    input.pageNumber,
  );
  console.log(
    JSON.stringify({ status: "RETRY_QUEUED", pageNumber: input.pageNumber }),
  );
} finally {
  await database.close();
}
