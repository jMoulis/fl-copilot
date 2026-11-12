import { APICallError } from "ai";
import { captureApiError } from "../observability";
import { createHash } from "node:crypto";
import type { Collection } from "mongodb";
import { type Product } from "@fl-copilot/domain";
import {
  serializeProductDocument,
  type ProductDocument,
} from "./product-master";
import {
  productImageResultSchema,
  type ProductImageOptions,
  type ProductImageRequest,
  type ProductImageResult,
  type GeneratedProductImage,
} from "@fl-copilot/sync-contracts";
import type { DatabaseService } from "../database/types";
import { AuthError } from "../auth/service";
import {
  createVisualBlobStorage,
  type VisualFilePrincipal,
  type VisualFileStorage,
} from "./visual-file-service";
import {
  inspectGeneratedProductImage,
  productImagePrompt,
  PRODUCT_IMAGE_PROMPT_VERSION,
} from "./product-image-provider";

export const PRODUCT_IMAGE_GENERATIONS = "productImageGenerations";
type Attempt = ProductImageResult & {
  _id: string;
  storeId: string;
  ownerId: string;
  policyId: string;
  updatedAt: Date;
  createdAt: Date;
  product: Product;
  failureCode?: string;
  failureStage?: string;
  providerStatus?: number;
  providerUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};
export interface ProductImagePolicy {
  enabled: boolean;
  model: string;
  estimatedCostUsd?: number;
}
const fail = (code: string, message: string, status = 409) =>
  new AuthError(status, code, message);
const missing = () =>
  fail("PRODUCT_IMAGE_NOT_FOUND", "Cette génération est introuvable.", 404);
export function createProductImageService(
  database: DatabaseService,
  policy: ProductImagePolicy,
  provider: {
    generate(product: Product): Promise<{
      bytes: Uint8Array;
      image: Pick<GeneratedProductImage, "provenance">;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }>;
  },
  files: Pick<
    VisualFileStorage,
    "writeImmutable" | "read"
  > = createVisualBlobStorage(),
  now: () => Date = () => new Date(),
) {
  const policyId = createHash("sha256")
    .update(
      JSON.stringify({
        ...policy,
        quality: "high",
        size: "1024x1024",
        promptVersion: PRODUCT_IMAGE_PROMPT_VERSION,
      }),
    )
    .digest("hex");
  const key = (a: Attempt) =>
    `stores/${a.storeId}/product-image-generations/${a.requestId}.png`;
  function manager(ctx: VisualFilePrincipal) {
    if (ctx.role !== "MANAGER")
      throw fail(
        "VISUAL_ACCESS_INVALID",
        "Seul le responsable peut générer une image.",
        403,
      );
  }
  async function product(ctx: VisualFilePrincipal, productId: string) {
    const db = await database.getDb();
    const row = await db
      .collection<ProductDocument>("products")
      .findOne({ _id: productId, storeId: ctx.storeId, deletedAt: null });
    if (!row) throw missing();
    const p = serializeProductDocument(row);
    if (p.status === "INACTIVE") throw missing();
    try {
      productImagePrompt(p);
    } catch {
      throw fail(
        "PRODUCT_IMAGE_INPUT_LIMIT",
        "La description du conditionnement est trop longue. Raccourcis-la dans la fiche produit avant de générer une image.",
      );
    }
    return p;
  }
  async function attempts() {
    return (await database.getDb()).collection<Attempt>(
      PRODUCT_IMAGE_GENERATIONS,
    );
  }
  async function read(ctx: VisualFilePrincipal, requestId: string) {
    manager(ctx);
    const c = await attempts();
    let row = await c.findOne({
      _id: requestId,
      storeId: ctx.storeId,
      ownerId: ctx.userId,
    });
    if (!row) throw missing();
    // A timed-out worker is never repeated: the provider may already have charged it.
    if (
      row.status === "RUNNING" &&
      now().getTime() - row.createdAt.getTime() > 240_000
    ) {
      await c.updateOne(
        { _id: row._id, status: "RUNNING" },
        { $set: { status: "UNKNOWN", updatedAt: now() } },
      );
      row = (await c.findOne({
        _id: row._id,
        storeId: ctx.storeId,
        ownerId: ctx.userId,
      }))!;
    }
    return row;
  }
  const result = (a: Attempt) => {
    if (a.failureCode === "PRODUCT_IMAGE_TRANSPARENCY_INVALID")
      throw fail(
        a.failureCode,
        "L’image reçue n’a pas un fond suffisamment transparent. Elle n’a pas été appliquée. Abandonne cet essai avant d’en demander une autre.",
        422,
      );
    if (a.failureCode === "PRODUCT_IMAGE_INVALID")
      throw fail(
        a.failureCode,
        "L’image reçue ne respecte pas le format attendu. Elle n’a pas été appliquée. Abandonne cet essai avant d’en demander une autre.",
        422,
      );
    return productImageResultSchema.parse({
      requestId: a.requestId,
      productId: a.productId,
      productVersion: a.productVersion,
      status: a.status,
      image: a.image,
    });
  };
  return {
    async options(
      ctx: VisualFilePrincipal,
      productId: string,
    ): Promise<ProductImageOptions> {
      manager(ctx);
      const p = await product(ctx, productId);
      const configured = policy.enabled && !!policy.estimatedCostUsd;
      return {
        available: configured && p.nature !== "UNKNOWN",
        reasonFr: !configured
          ? "La génération d’images n’est pas encore activée."
          : p.nature === "UNKNOWN"
            ? "Précise d’abord si ce produit est vendu en vrac ou conditionné."
            : null,
        model: policy.model,
        estimatedCostUsd: policy.estimatedCostUsd ?? null,
        policyId,
        productVersion: p.version,
      };
    },
    async generate(ctx: VisualFilePrincipal, input: ProductImageRequest) {
      manager(ctx);
      const c: Collection<Attempt> = await attempts();
      const existing = await c.findOne({ _id: input.requestId });
      if (existing) {
        if (existing.storeId !== ctx.storeId || existing.ownerId !== ctx.userId)
          throw missing();
        if (
          existing.productId !== input.productId ||
          existing.productVersion !== input.productVersion ||
          existing.policyId !== input.policyId
        )
          throw fail(
            "PRODUCT_IMAGE_REQUEST_CHANGED",
            "Cette demande a changé. Relis son aperçu.",
          );
        return result(await read(ctx, input.requestId));
      }
      const p = await product(ctx, input.productId);
      if (!policy.enabled || !policy.estimatedCostUsd)
        throw fail(
          "PRODUCT_IMAGE_DISABLED",
          "La génération d’images n’est pas encore activée.",
        );
      if (
        input.policyId !== policyId ||
        p.version !== input.productVersion ||
        p.nature === "UNKNOWN"
      )
        throw fail(
          "PRODUCT_IMAGE_SOURCE_CHANGED",
          "La fiche ou le tarif a changé. Relis la proposition avant de générer.",
        );
      const at = now();
      await c.updateMany(
        {
          storeId: ctx.storeId,
          status: "RUNNING",
          createdAt: { $lt: new Date(at.getTime() - 240_000) },
        },
        { $set: { status: "UNKNOWN", updatedAt: at } },
      );
      const attempt: Attempt = {
        _id: input.requestId,
        requestId: input.requestId,
        productId: p.id,
        productVersion: p.version,
        storeId: ctx.storeId,
        ownerId: ctx.userId,
        policyId,
        product: p,
        status: "RUNNING",
        image: null,
        createdAt: at,
        updatedAt: at,
      };
      try {
        await c.insertOne(attempt);
      } catch (e) {
        if (typeof e !== "object" || !e || !("code" in e) || e.code !== 11000)
          throw e;
        const retry = await c.findOne({ _id: input.requestId });
        if (
          retry &&
          retry.storeId === ctx.storeId &&
          retry.ownerId === ctx.userId &&
          retry.productId === input.productId &&
          retry.productVersion === input.productVersion &&
          retry.policyId === input.policyId
        )
          return result(retry);
        throw fail(
          "PRODUCT_IMAGE_BUSY",
          "Une génération est déjà en cours pour ce magasin. Consulte son résultat avant d’en lancer une autre.",
        );
      }
      let stage = "PROVIDER";
      try {
        const generated = await provider.generate(p);
        stage = "PERSISTENCE";
        // Record usage before inspecting pixels: rejected output can still be billed.
        await c.updateOne(
          { _id: attempt._id },
          {
            $set: {
              ...(generated.usage ? { providerUsage: generated.usage } : {}),
              updatedAt: now(),
            },
          },
        );
        stage = "STORAGE";
        // Keep the private original even when validation rejects the preview.
        if (generated.bytes.length <= 12 * 1024 * 1024)
          await files.writeImmutable(
            key(attempt),
            generated.bytes,
            "image/png",
          );
        stage = "VALIDATION";
        const descriptor = await inspectGeneratedProductImage(generated.bytes);
        const image: GeneratedProductImage = {
          ...descriptor,
          provenance: generated.image.provenance,
        };
        stage = "PERSISTENCE";
        await c.updateOne(
          { _id: attempt._id, storeId: ctx.storeId, ownerId: ctx.userId },
          {
            $set: {
              status: "READY",
              image,
              ...(generated.usage ? { providerUsage: generated.usage } : {}),
              updatedAt: now(),
            },
          },
        );
      } catch (error) {
        const code =
          error instanceof Error &&
          [
            "PRODUCT_IMAGE_INVALID",
            "PRODUCT_IMAGE_TRANSPARENCY_INVALID",
          ].includes(error.message)
            ? error.message
            : "PRODUCT_IMAGE_GENERATION_FAILED";
        const providerStatus = APICallError.isInstance(error)
          ? error.statusCode
          : undefined;
        captureApiError(new Error(code), {
          code,
          method: "POST",
          requestId: attempt.requestId,
        });
        // Log only allowlisted technical metadata, never provider bodies or prompts.
        console.warn(
          JSON.stringify({
            event: "product_image_generation_failed",
            requestId: attempt.requestId,
            stage,
            code,
            providerStatus,
          }),
        );
        // Never repeat a potentially billable request.
        await c.updateOne(
          { _id: attempt._id, status: "RUNNING" },
          {
            $set: {
              status: "UNKNOWN",
              failureCode: code,
              failureStage: stage,
              ...(providerStatus ? { providerStatus } : {}),
              updatedAt: now(),
            },
          },
        );
      }
      return result(await read(ctx, input.requestId));
    },
    async status(ctx: VisualFilePrincipal, requestId: string) {
      return result(await read(ctx, requestId));
    },
    async file(ctx: VisualFilePrincipal, requestId: string) {
      const a = await read(ctx, requestId);
      if (a.status !== "READY" || !a.image) throw missing();
      const bytes = await files.read(key(a), a.image.sizeBytes);
      if (
        !bytes ||
        (await inspectGeneratedProductImage(bytes)).contentHash !==
          a.image.contentHash
      )
        throw missing();
      return bytes;
    },
  };
}
export type ProductImageService = ReturnType<typeof createProductImageService>;
