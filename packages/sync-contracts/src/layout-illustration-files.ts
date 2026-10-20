import { z } from "zod";
import {
  layoutIllustrationPreparationSchema,
  sameLayoutIllustrationPreparation,
  type LayoutIllustrationPreparation,
} from "@fl-copilot/domain";
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const png = z.strictObject({
  checksum: hash,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(12 * 1024 * 1024),
  mimeType: z.literal("image/png"),
  width: z.literal(1536),
  height: z.literal(1024),
});
export const layoutIllustrationFileVariantSchema = z.enum([
  "source",
  "original",
  "image",
  "data",
]);
export type LayoutIllustrationFileVariant = z.infer<
  typeof layoutIllustrationFileVariantSchema
>;
export const layoutIllustrationMetadataSchema = z.strictObject({
  id: z.uuid(),
  preparation: layoutIllustrationPreparationSchema,
  createdAt: z.iso.datetime(),
  provenance: z.strictObject({
    provider: z.literal("OPENAI"),
    textModel: z.string().min(1).max(100),
    imageModel: z.string().min(1).max(100),
    promptVersion: z.literal("layout-illustration-v1"),
    responseId: z.string().min(1).max(200).nullable(),
  }),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
  limitations: z.array(z.string().min(1).max(2000)).max(100),
  files: z.strictObject({
    source: png,
    original: png,
    image: png,
    data: z.strictObject({
      checksum: hash,
      sizeBytes: z
        .number()
        .int()
        .positive()
        .max(2 * 1024 * 1024),
      mimeType: z.literal("application/json"),
    }),
  }),
});
export const layoutIllustrationManifestSchema =
  layoutIllustrationMetadataSchema.extend({ manifestHash: hash });
export type LayoutIllustrationManifest = z.infer<
  typeof layoutIllustrationManifestSchema
>;
export function serializeLayoutIllustrationMetadata(raw: unknown) {
  return JSON.stringify(layoutIllustrationMetadataSchema.parse(raw));
}
export function readLayoutIllustrationManifest(
  raw: unknown,
  preparation: LayoutIllustrationPreparation,
) {
  const value = layoutIllustrationManifestSchema.parse(raw);
  if (!sameLayoutIllustrationPreparation(value.preparation, preparation))
    throw Error("LAYOUT_ILLUSTRATION_FILE_BINDING_INVALID");
  return value;
}
export const layoutIllustrationFileStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("EMPTY"), preparationId: z.uuid() }),
  z.strictObject({
    state: z.literal("READY"),
    manifest: layoutIllustrationManifestSchema,
  }),
]);
