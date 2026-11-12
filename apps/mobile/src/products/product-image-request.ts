import { z } from "zod";
import {
  productImageRequestSchema,
  type ProductImageRequest,
} from "@fl-copilot/sync-contracts";
import type { OutboxDatabase } from "../sync/outbox-repository";

/** A retained request ID is an anti-double-charge receipt, not a business mutation or an automatic retry job. */
export async function readProductImageRequest(
  db: OutboxDatabase,
  storeId: string,
  ownerId: string,
  productId: string,
) {
  const row = await db.getFirstAsync<{ payload_json: string }>(
    "SELECT payload_json FROM local_jobs WHERE type='PRODUCT_IMAGE_GENERATION' AND status='AWAITING_REVIEW' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=? AND json_extract(payload_json,'$.input.productId')=? ORDER BY rowid DESC LIMIT 1",
    storeId,
    ownerId,
    productId,
  );
  if (!row) return null;
  return z
    .strictObject({
      storeId: z.uuid(),
      ownerId: z.uuid(),
      input: productImageRequestSchema,
    })
    .parse(JSON.parse(row.payload_json)).input;
}
export async function retainProductImageRequest(
  db: OutboxDatabase,
  storeId: string,
  ownerId: string,
  raw: ProductImageRequest,
  at: string,
) {
  const input = productImageRequestSchema.parse(raw);
  z.uuid().parse(storeId);
  z.uuid().parse(ownerId);
  await db.runAsync(
    "INSERT INTO local_jobs(id,type,payload_json,status,attempt_count,created_at,updated_at) VALUES(?,'PRODUCT_IMAGE_GENERATION',?,'AWAITING_REVIEW',0,?,?)",
    input.requestId,
    JSON.stringify({ storeId, ownerId, input }),
    at,
    at,
  );
  return input;
}
export async function finishProductImageRequest(
  db: OutboxDatabase,
  storeId: string,
  ownerId: string,
  requestId: string,
  selected: boolean,
  at: string,
) {
  await db.runAsync(
    "UPDATE local_jobs SET status=?,updated_at=? WHERE id=? AND type='PRODUCT_IMAGE_GENERATION' AND json_extract(payload_json,'$.storeId')=? AND json_extract(payload_json,'$.ownerId')=?",
    selected ? "COMPLETED" : "DISMISSED",
    at,
    requestId,
    storeId,
    ownerId,
  );
}
