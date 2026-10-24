import { createHash, randomUUID } from "node:crypto";
import { open, realpath, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve, sep, isAbsolute } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  visualProvenanceSchema,
  visualAssetSchema,
  visualIdentitySchema,
  productVisualLinkSchema,
  visualIdMaterial,
  visualIdFromDigest,
  detectVisualImageMime,
  VISUAL_LIBRARY_POLICY,
  type VisualAsset,
  type VisualIdentity,
  type ProductVisualLink,
} from "@fl-copilot/domain";
import {
  authSessionResponseSchema,
  bootstrapResponseSchema,
  syncCommandSchema,
  syncPushRequestSchema,
  readVisualFileManifest,
  type BootstrapResponse,
  type SyncCommand,
  type SyncPushResponse,
  type InitVisualFileResponse,
  type VisualFileManifest,
} from "@fl-copilot/sync-contracts";

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const key = z.enum(["tomato_round", "banana_cavendish", "avocado_hass"]);
export const pilotInputSchema = z
  .strictObject({
    schema: z.literal("fl-copilot-visual-pilot/v1"),
    pilotId: z.uuid(),
    items: z
      .array(
        z.strictObject({
          visualKey: key,
          canonicalName: z.string().trim().min(1).max(240),
          productId: z.uuid().nullable(),
          file: z.string().min(1).nullable(),
          provenance: visualProvenanceSchema.nullable(),
          generation: z
            .strictObject({
              generatedAt: z.iso.datetime(),
              originalFile: z.string().min(1),
              promptFile: z.string().min(1),
              evidenceFile: z.string().min(1),
              transformations: z
                .array(
                  z.strictObject({
                    tool: z.string().min(1),
                    kind: z.string().min(1),
                    at: z.iso.datetime(),
                    inputHash: sha,
                    outputHash: sha,
                  }),
                )
                .max(20),
            })
            .nullable(),
        }),
      )
      .length(3),
  })
  .refine((v) => new Set(v.items.map((i) => i.visualKey)).size === 3);
export type PilotInput = z.infer<typeof pilotInputSchema>;
export const pilotSessionSchema = authSessionResponseSchema
  .omit({ refreshToken: true })
  .extend({ deviceId: z.uuid() })
  .strict();
export type PilotSession = z.infer<typeof pilotSessionSchema>;
export class VisualPilotError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function stop(code: string): never {
  throw new VisualPilotError(code);
}
export const pilotHash = (data: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;
function id(
  kind: "visual_asset" | "product_visual_link",
  storeId: string,
  value: string,
) {
  return visualIdFromDigest(
    pilotHash(visualIdMaterial(kind, storeId, value)).slice(7),
  );
}
async function localBytes(
  root: string,
  relative: string,
  maximum = VISUAL_LIBRARY_POLICY.maximumBytes,
) {
  if (isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    stop("PILOT_FILE_PATH_INVALID");
  const base = await realpath(root),
    path = resolve(base, relative),
    stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size <= 0 ||
    stat.size > maximum
  )
    stop("PILOT_FILE_INVALID");
  const canonical = await realpath(path);
  if (!canonical.startsWith(base + sep)) stop("PILOT_FILE_PATH_INVALID");
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let bytes: Uint8Array;
  try {
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.size !== stat.size
    )
      stop("PILOT_FILE_CHANGED");
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    bytes = new Uint8Array(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
  if (bytes.length !== stat.size) stop("PILOT_FILE_CHANGED");
  return { bytes, path: canonical, hash: pilotHash(bytes) };
}
export async function inspectPilotItem(
  root: string,
  raw: PilotInput["items"][number],
) {
  const item = pilotInputSchema.shape.items.element.parse(raw);
  if (!item.file) stop("PILOT_IMAGE_MISSING");
  if (
    !item.provenance ||
    item.provenance.type !== "AI_GENERATED" ||
    [
      item.provenance.provider,
      item.provenance.model,
      item.provenance.promptVersion,
    ].some((v) => /^(unknown|todo|placeholder)$/i.test(v))
  )
    stop("PILOT_PROVENANCE_MISSING");
  if (!item.generation) stop("PILOT_GENERATION_EVIDENCE_MISSING");
  if (!item.productId) stop("PILOT_EXACT_PRODUCT_REQUIRED");
  if (/(^|[\\/])reference([\\/]|$)|style_reference_only/i.test(item.file))
    stop("PILOT_REFERENCE_IS_NOT_AN_ASSET");
  const file = await localBytes(root, item.file);
  if (detectVisualImageMime(file.bytes) !== "image/png")
    stop("PILOT_RGBA_PNG_REQUIRED");
  const image = sharp(file.bytes, {
    failOn: "error",
    limitInputPixels: VISUAL_LIBRARY_POLICY.maximumPixels,
  });
  const meta = await image.metadata();
  if (
    meta.format !== "png" ||
    (meta.pages ?? 1) !== 1 ||
    !meta.width ||
    !meta.height ||
    meta.width > 12000 ||
    meta.height > 12000 ||
    meta.width * meta.height > VISUAL_LIBRARY_POLICY.maximumPixels ||
    meta.channels !== 4 ||
    !meta.hasAlpha
  )
    stop("PILOT_RGBA_PNG_REQUIRED");
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const corners = [
    0,
    info.width - 1,
    (info.height - 1) * info.width,
    info.height * info.width - 1,
  ];
  let transparent = 0,
    opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) transparent++;
    if (data[i] === 255) opaque++;
  }
  if (!transparent || !opaque || corners.some((p) => data[p * 4 + 3] !== 0))
    stop("PILOT_REAL_ALPHA_REQUIRED");
  const [original, prompt, evidence] = await Promise.all([
    localBytes(root, item.generation.originalFile),
    localBytes(root, item.generation.promptFile, 256 * 1024),
    localBytes(root, item.generation.evidenceFile, 1024 * 1024),
  ]);
  let previous = original.hash;
  for (const transform of item.generation.transformations) {
    if (transform.inputHash !== previous) stop("PILOT_TRANSFORM_CHAIN_INVALID");
    previous = transform.outputHash;
  }
  if (previous !== file.hash) stop("PILOT_TRANSFORM_CHAIN_INVALID");
  return {
    item,
    file,
    descriptor: {
      contentHash: file.hash,
      mimeType: "image/png" as const,
      width: meta.width,
      height: meta.height,
      sizeBytes: file.bytes.length,
    },
    audit: {
      originalHash: original.hash,
      promptHash: prompt.hash,
      evidenceHash: evidence.hash,
      generatedAt: item.generation.generatedAt,
      transformations: item.generation.transformations,
      transparentPixels: transparent,
      opaquePixels: opaque,
    },
  };
}
export async function inspectPilot(root: string, raw: unknown) {
  const input = pilotInputSchema.parse(raw);
  const items = await Promise.all(
    input.items.map(async (item) => {
      try {
        const p = await inspectPilotItem(root, item);
        return {
          visualKey: item.visualKey,
          status: "READY_FOR_HUMAN_REVIEW" as const,
          productId: item.productId,
          file: item.file,
          descriptor: p.descriptor,
          audit: p.audit,
        };
      } catch (error) {
        return {
          visualKey: item.visualKey,
          status: "BLOCKED" as const,
          productId: item.productId,
          file: item.file,
          blocker:
            error instanceof VisualPilotError
              ? error.code
              : "PILOT_INPUT_INVALID",
        };
      }
    }),
  );
  return {
    schema: input.schema,
    pilotId: input.pilotId,
    status: items.some((i) => i.status === "BLOCKED")
      ? "BLOCKED"
      : "PREPARED_NOT_APPROVED",
    items,
  };
}
export interface VisualPilotApi {
  snapshot(): Promise<BootstrapResponse>;
  push(commands: SyncCommand[]): Promise<SyncPushResponse>;
  init(assetId: string): Promise<InitVisualFileResponse>;
  complete(assetId: string, uploadId: string): Promise<VisualFileManifest>;
  manifest(assetId: string): Promise<VisualFileManifest>;
  download(
    manifest: VisualFileManifest,
    variant: "source" | "preview",
  ): Promise<Uint8Array>;
  put(
    url: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
  ): Promise<void>;
}
export type PilotAuthority = {
  storeId: string;
  actorId: string;
  deviceId: string;
};
const approvalSchema = z.strictObject({
  actorId: z.uuid(),
  at: z.iso.datetime(),
  digest: sha,
  channel: z.literal("INTERACTIVE_HUMAN"),
});
export const pilotRunSchema = z.strictObject({
  schema: z.literal("fl-copilot-visual-pilot-run/v1"),
  pilotId: z.uuid(),
  visualKey: key,
  storeId: z.uuid(),
  actorId: z.uuid(),
  deviceId: z.uuid(),
  productId: z.uuid(),
  productHash: sha,
  fileHash: sha,
  auditHash: sha,
  review: approvalSchema,
  asset: visualAssetSchema,
  identity: visualIdentitySchema,
  link: productVisualLinkSchema,
  assetCommand: syncCommandSchema.nullable(),
  identityCommand: syncCommandSchema.nullable(),
  linkCommand: syncCommandSchema,
  phase: z.enum([
    "REVIEWED",
    "ASSET_ACK",
    "FILE_VERIFIED",
    "LINK_ACK",
    "AWAITING_MOBILE",
  ]),
  manifest: z.unknown().nullable(),
});
export type PilotRun = z.infer<typeof pilotRunSchema>;
export type PilotReviewDraft = {
  visualKey: PilotInput["items"][number]["visualKey"];
  storeId: string;
  actorId: string;
  productId: string;
  productLabel: string;
  file: string;
  fileHash: string;
  provenance: VisualAsset["provenance"];
  auditHash: string;
  digest: string;
};
function graph(raw: unknown, scope: PilotAuthority) {
  const snapshot = bootstrapResponseSchema.parse(raw);
  if (
    snapshot.store.id !== scope.storeId ||
    snapshot.store.role !== "MANAGER" ||
    snapshot.entities.visualLibrary !== true
  )
    stop("PILOT_STORE_AUTHORITY_REQUIRED");
  return {
    snapshot,
    assets: (snapshot.entities.visualAssets ?? []).map((v) =>
      visualAssetSchema.parse(v),
    ),
    identities: (snapshot.entities.visualIdentities ?? []).map((v) =>
      visualIdentitySchema.parse(v),
    ),
    links: (snapshot.entities.productVisualLinks ?? []).map((v) =>
      productVisualLinkSchema.parse(v),
    ),
  };
}
function eligibleProduct(
  g: ReturnType<typeof graph>,
  scope: PilotAuthority,
  productId: string,
) {
  const p = g.snapshot.entities.products.find((v) => v.id === productId);
  if (
    !p ||
    p.storeId !== scope.storeId ||
    p.deletedAt ||
    p.status !== "ACTIVE" ||
    p.nature !== "BULK"
  )
    stop("PILOT_EXACT_PRODUCT_UNAVAILABLE");
  return p;
}
const same = isDeepStrictEqual;
function unchangedLink(
  g: ReturnType<typeof graph>,
  productId: string,
  planned?: ProductVisualLink,
) {
  const existing = g.links.filter((l) => l.productId === productId);
  if (
    existing.length &&
    !(planned && existing.length === 1 && same(existing[0], planned))
  )
    stop("PILOT_EXISTING_LINK_REQUIRES_MANUAL_REVIEW");
}
export const pilotMobileReviewSchema = z.strictObject({
  pilotId: z.uuid(),
  storeId: z.uuid(),
  actorId: z.uuid(),
  firstProductId: z.uuid(),
  firstAssetId: z.uuid(),
  firstContentHash: sha,
  at: z.iso.datetime(),
  screenshotHash: sha,
  channel: z.literal("INTERACTIVE_HUMAN"),
  offlineConfirmed: z.literal(true),
});
export type PilotMobileReview = z.infer<typeof pilotMobileReviewSchema>;
function firstGate(
  input: PilotInput,
  scope: PilotAuthority,
  visualKey: z.infer<typeof key>,
  firstRun?: PilotRun,
  review?: PilotMobileReview,
) {
  if (visualKey === "tomato_round") return;
  if (!firstRun || !review) stop("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
  const first = pilotRunSchema.parse(firstRun),
    r = pilotMobileReviewSchema.parse(review);
  if (
    first.visualKey !== "tomato_round" ||
    first.phase !== "AWAITING_MOBILE" ||
    first.pilotId !== input.pilotId ||
    r.pilotId !== input.pilotId ||
    first.storeId !== scope.storeId ||
    r.storeId !== scope.storeId ||
    r.actorId !== scope.actorId ||
    first.productId !==
      input.items.find((i) => i.visualKey === "tomato_round")?.productId ||
    r.firstProductId !== first.productId ||
    r.firstAssetId !== first.asset.id ||
    r.firstContentHash !== first.fileHash ||
    r.screenshotHash === first.fileHash
  )
    stop("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
  readVisualFileManifest(first.manifest, first.asset);
}
export async function verifyPilotReadback(
  api: VisualPilotApi,
  scope: PilotAuthority,
  run: PilotRun,
) {
  const g = graph(await api.snapshot(), scope);
  eligibleProduct(g, scope, run.productId);
  if (
    !g.assets.some((a) => same(a, run.asset)) ||
    !g.identities.some((i) => same(i, run.identity)) ||
    !g.links.some((l) => same(l, run.link))
  )
    stop("PILOT_SYNC_READBACK_INVALID");
  const manifest = readVisualFileManifest(
    await api.manifest(run.asset.id),
    run.asset,
  );
  if (!same(manifest, readVisualFileManifest(run.manifest, run.asset)))
    stop("PILOT_MANIFEST_CHANGED");
}
async function verifyFirstGate(
  api: VisualPilotApi,
  scope: PilotAuthority,
  visualKey: z.infer<typeof key>,
  firstRun?: PilotRun,
) {
  if (visualKey !== "tomato_round") {
    if (!firstRun) stop("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
    await verifyPilotReadback(api, scope, firstRun);
  }
}
export async function recordPilotMobileReview(options: {
  api: VisualPilotApi;
  run: PilotRun;
  screenshotRoot: string;
  screenshotFile: string;
  scope: PilotAuthority;
  confirm: (digest: string) => Promise<string>;
  now?: () => string;
}) {
  const run = pilotRunSchema.parse(options.run);
  if (
    run.visualKey !== "tomato_round" ||
    run.phase !== "AWAITING_MOBILE" ||
    run.actorId !== options.scope.actorId ||
    run.storeId !== options.scope.storeId
  )
    stop("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
  readVisualFileManifest(run.manifest, run.asset);
  await verifyPilotReadback(options.api, options.scope, run);
  const file = await localBytes(options.screenshotRoot, options.screenshotFile);
  if (
    !["image/png", "image/jpeg"].includes(
      detectVisualImageMime(file.bytes) ?? "",
    ) ||
    file.hash === run.fileHash
  )
    stop("PILOT_MOBILE_SCREENSHOT_REQUIRED");
  await sharp(file.bytes, {
    failOn: "error",
    limitInputPixels: VISUAL_LIBRARY_POLICY.maximumPixels,
  }).metadata();
  const digest = pilotHash(
    JSON.stringify({
      pilotId: run.pilotId,
      productId: run.productId,
      assetId: run.asset.id,
      fileHash: run.fileHash,
      screenshotHash: file.hash,
      scope: options.scope,
    }),
  );
  if ((await options.confirm(digest)) !== digest)
    stop("PILOT_HUMAN_APPROVAL_REQUIRED");
  return pilotMobileReviewSchema.parse({
    pilotId: run.pilotId,
    storeId: run.storeId,
    actorId: options.scope.actorId,
    firstProductId: run.productId,
    firstAssetId: run.asset.id,
    firstContentHash: run.fileHash,
    at: (options.now ?? (() => new Date().toISOString()))(),
    screenshotHash: file.hash,
    channel: "INTERACTIVE_HUMAN",
    offlineConfirmed: true,
  });
}
export async function createPilotRun(options: {
  root: string;
  input: PilotInput;
  visualKey: z.infer<typeof key>;
  scope: PilotAuthority;
  api: VisualPilotApi;
  review: (draft: PilotReviewDraft) => Promise<string>;
  now?: () => string;
  firstRun?: PilotRun;
  mobileReview?: PilotMobileReview;
}) {
  const input = pilotInputSchema.parse(options.input);
  firstGate(
    input,
    options.scope,
    options.visualKey,
    options.firstRun,
    options.mobileReview,
  );
  await verifyFirstGate(
    options.api,
    options.scope,
    options.visualKey,
    options.firstRun,
  );
  const item =
    input.items.find((i) => i.visualKey === options.visualKey) ??
    stop("PILOT_ITEM_UNKNOWN");
  const prepared = await inspectPilotItem(options.root, item),
    g = graph(await options.api.snapshot(), options.scope),
    product = eligibleProduct(g, options.scope, item.productId!);
  unchangedLink(g, product.id);
  const assetId = id(
      "visual_asset",
      options.scope.storeId,
      prepared.descriptor.contentHash,
    ),
    existing = g.assets.find((a) => a.id === assetId);
  if (
    existing &&
    (existing.storeId !== options.scope.storeId ||
      existing.deletedAt ||
      existing.review.status !== "APPROVED" ||
      !same(existing.provenance, item.provenance) ||
      existing.contentHash !== prepared.descriptor.contentHash)
  )
    stop("PILOT_EXISTING_ASSET_REQUIRES_REVIEW");
  const compatible = g.identities.filter(
    (i) =>
      !i.deletedAt &&
      i.storeId === options.scope.storeId &&
      i.primaryAssetId === assetId &&
      i.canonicalName === item.canonicalName &&
      i.specificity === "GENERIC" &&
      i.brand === null &&
      i.appearance === null &&
      i.variety === null,
  );
  if (compatible.length > 1) stop("PILOT_AMBIGUOUS_VISUAL_IDENTITY");
  const auditHash = pilotHash(JSON.stringify(prepared.audit));
  const summary = {
    visualKey: item.visualKey,
    storeId: options.scope.storeId,
    actorId: options.scope.actorId,
    productId: product.id,
    productLabel: product.label,
    file: prepared.file.path,
    fileHash: prepared.descriptor.contentHash,
    provenance: item.provenance!,
    auditHash,
  };
  const draft = { ...summary, digest: pilotHash(JSON.stringify(summary)) };
  if ((await options.review(draft)) !== draft.digest)
    stop("PILOT_HUMAN_APPROVAL_REQUIRED");
  const at = (options.now ?? (() => new Date().toISOString()))();
  const base = {
    storeId: options.scope.storeId,
    createdBy: options.scope.actorId,
    updatedBy: options.scope.actorId,
    version: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const asset =
    existing ??
    visualAssetSchema.parse({
      ...base,
      id: assetId,
      ...prepared.descriptor,
      provenance: item.provenance,
      review: { status: "APPROVED", actorId: options.scope.actorId, at },
    });
  const identity =
    compatible[0] ??
    visualIdentitySchema.parse({
      ...base,
      id: randomUUID(),
      canonicalName: item.canonicalName,
      specificity: "GENERIC",
      variety: null,
      appearance: null,
      brand: null,
      primaryAssetId: asset.id,
    });
  const link = productVisualLinkSchema.parse({
    ...base,
    id: id("product_visual_link", options.scope.storeId, product.id),
    productId: product.id,
    visualIdentityId: identity.id,
    overrideAssetId: null,
    linkType: "INHERITED_GENERIC",
    verification: "APPROVED",
    verifiedBy: options.scope.actorId,
    verifiedAt: at,
  });
  const command = (
    entityType: string,
    payload: VisualAsset | VisualIdentity | ProductVisualLink,
    sequence: number,
  ) =>
    syncCommandSchema.parse({
      commandId: randomUUID(),
      localSequence: sequence,
      type: `${entityType.toUpperCase()}_UPSERT`,
      entityType,
      entityId: payload.id,
      expectedRemoteVersion: null,
      createdAt: at,
      payload,
    });
  return pilotRunSchema.parse({
    schema: "fl-copilot-visual-pilot-run/v1",
    pilotId: input.pilotId,
    visualKey: item.visualKey,
    ...options.scope,
    productId: product.id,
    productHash: pilotHash(JSON.stringify(product)),
    fileHash: prepared.descriptor.contentHash,
    auditHash,
    review: {
      actorId: options.scope.actorId,
      at,
      digest: draft.digest,
      channel: "INTERACTIVE_HUMAN",
    },
    asset,
    identity,
    link,
    assetCommand: existing ? null : command("visual_asset", asset, 1),
    identityCommand: compatible.length
      ? null
      : command("visual_identity", identity, 2),
    linkCommand: command("product_visual_link", link, 3),
    phase: "REVIEWED",
    manifest: null,
  });
}
export async function runPilotImport(options: {
  root: string;
  input: PilotInput;
  scope: PilotAuthority;
  api: VisualPilotApi;
  run: PilotRun;
  persist: (run: PilotRun) => Promise<void>;
  firstRun?: PilotRun;
  mobileReview?: PilotMobileReview;
}) {
  const run = pilotRunSchema.parse(options.run),
    input = pilotInputSchema.parse(options.input),
    item =
      input.items.find((i) => i.visualKey === run.visualKey) ??
      stop("PILOT_ITEM_UNKNOWN");
  firstGate(
    input,
    options.scope,
    run.visualKey,
    options.firstRun,
    options.mobileReview,
  );
  await verifyFirstGate(
    options.api,
    options.scope,
    run.visualKey,
    options.firstRun,
  );
  if (
    run.pilotId !== input.pilotId ||
    !same(options.scope, {
      storeId: run.storeId,
      actorId: run.actorId,
      deviceId: run.deviceId,
    }) ||
    run.review.actorId !== run.actorId ||
    run.productId !== item.productId
  )
    stop("PILOT_RUN_SCOPE_CHANGED");
  const p = await inspectPilotItem(options.root, item);
  if (
    p.descriptor.contentHash !== run.fileHash ||
    pilotHash(JSON.stringify(p.audit)) !== run.auditHash ||
    !same(run.asset.provenance, item.provenance)
  )
    stop("PILOT_APPROVED_INPUT_CHANGED");
  if (
    run.asset.id !== id("visual_asset", run.storeId, run.fileHash) ||
    run.asset.storeId !== run.storeId ||
    run.asset.contentHash !== p.descriptor.contentHash ||
    run.asset.mimeType !== p.descriptor.mimeType ||
    run.asset.width !== p.descriptor.width ||
    run.asset.height !== p.descriptor.height ||
    run.asset.sizeBytes !== p.descriptor.sizeBytes ||
    run.asset.deletedAt ||
    run.asset.review.status !== "APPROVED" ||
    run.identity.storeId !== run.storeId ||
    run.identity.primaryAssetId !== run.asset.id ||
    run.identity.canonicalName !== item.canonicalName ||
    run.identity.specificity !== "GENERIC" ||
    run.identity.brand !== null ||
    run.identity.variety !== null ||
    run.identity.deletedAt ||
    run.link.id !== id("product_visual_link", run.storeId, run.productId) ||
    run.link.storeId !== run.storeId ||
    run.link.productId !== run.productId ||
    run.link.visualIdentityId !== run.identity.id ||
    run.link.overrideAssetId !== null ||
    run.link.linkType !== "INHERITED_GENERIC" ||
    run.link.verification !== "APPROVED" ||
    run.link.verifiedBy !== run.actorId ||
    run.link.verifiedAt !== run.review.at ||
    run.link.deletedAt
  )
    stop("PILOT_RUN_BINDING_INVALID");
  for (const [kind, command, payload] of [
    ["visual_asset", run.assetCommand, run.asset],
    ["visual_identity", run.identityCommand, run.identity],
    ["product_visual_link", run.linkCommand, run.link],
  ] as const) {
    if (
      command &&
      (command.entityType !== kind ||
        command.type !== `${kind.toUpperCase()}_UPSERT` ||
        command.entityId !== payload.id ||
        command.expectedRemoteVersion !== null ||
        command.createdAt !== run.review.at ||
        payload.createdBy !== run.actorId ||
        payload.updatedBy !== run.actorId ||
        payload.createdAt !== run.review.at ||
        payload.updatedAt !== run.review.at ||
        payload.version !== 1 ||
        !same(command.payload, payload))
    )
      stop("PILOT_RUN_BINDING_INVALID");
  }
  const fresh = graph(await options.api.snapshot(), options.scope),
    product = eligibleProduct(fresh, options.scope, run.productId);
  if (pilotHash(JSON.stringify(product)) !== run.productHash)
    stop("PILOT_PRODUCT_CHANGED");
  unchangedLink(fresh, run.productId, run.link);
  const summary = {
    visualKey: item.visualKey,
    storeId: run.storeId,
    actorId: run.actorId,
    productId: product.id,
    productLabel: product.label,
    file: p.file.path,
    fileHash: p.descriptor.contentHash,
    provenance: item.provenance!,
    auditHash: run.auditHash,
  };
  if (
    pilotHash(JSON.stringify(summary)) !== run.review.digest ||
    (!run.assetCommand && !fresh.assets.some((a) => same(a, run.asset))) ||
    (!run.identityCommand &&
      !fresh.identities.some((i) => same(i, run.identity))) ||
    (run.assetCommand &&
      (run.asset.review.actorId !== run.actorId ||
        run.asset.review.at !== run.review.at))
  )
    stop("PILOT_RUN_BINDING_INVALID");
  const acknowledge = async (command: SyncCommand | null) => {
    if (!command) return;
    const result = await options.api.push([command]);
    if (result.results.length !== 1) stop("PILOT_ACK_INVALID");
    const ack = result.results[0]!;
    if (
      ack.commandId !== command.commandId ||
      ack.entityId !== command.entityId ||
      ack.entityType !== command.entityType ||
      !["APPLIED", "ALREADY_APPLIED"].includes(ack.status)
    )
      stop(
        ack.status === "CONFLICT"
          ? "PILOT_CONFLICT_REQUIRES_REVIEW"
          : "PILOT_COMMAND_NOT_ACKNOWLEDGED",
      );
    if (!same(ack.remoteEntity, command.payload)) stop("PILOT_ACK_INVALID");
  };
  // Persist exact command UUIDs before the first possible write; an uncertain result reuses them.
  await options.persist(run);
  await acknowledge(run.assetCommand);
  run.phase = "ASSET_ACK";
  await options.persist(run);
  const init = await options.api.init(run.asset.id);
  let manifest: VisualFileManifest;
  if (init.state === "READY")
    manifest = readVisualFileManifest(init.manifest, run.asset);
  else {
    if (
      !init.uploadUrl ||
      !init.uploadId ||
      !init.expiresAt ||
      Date.parse(init.expiresAt) <= Date.now()
    )
      stop("PILOT_UPLOAD_LEASE_INVALID");
    const url = new URL(init.uploadUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.origin !== "https://vercel.com" ||
      url.pathname !== "/api/blob/" ||
      url.searchParams.getAll("pathname").length !== 1 ||
      url.searchParams.get("pathname") !==
        `stores/${run.storeId}/visual-staging/${init.uploadId}` ||
      Object.keys(init.headers).some(
        (k) => k.toLowerCase() !== "content-type",
      ) ||
      init.headers["content-type"] !== run.asset.mimeType
    )
      stop("PILOT_UPLOAD_LEASE_INVALID");
    if (pilotHash(p.file.bytes) !== run.fileHash)
      stop("PILOT_APPROVED_INPUT_CHANGED");
    await options.api.put(init.uploadUrl, p.file.bytes, init.headers);
    manifest = readVisualFileManifest(
      await options.api.complete(run.asset.id, init.uploadId),
      run.asset,
    );
  }
  const current = readVisualFileManifest(
    await options.api.manifest(run.asset.id),
    run.asset,
  );
  if (!same(current, manifest)) stop("PILOT_MANIFEST_CHANGED");
  const [source, preview] = await Promise.all([
    options.api.download(current, "source"),
    options.api.download(current, "preview"),
  ]);
  if (
    pilotHash(source) !== run.fileHash ||
    source.length !== run.asset.sizeBytes ||
    pilotHash(preview) !== current.preview.contentHash ||
    preview.length !== current.preview.sizeBytes ||
    detectVisualImageMime(preview) !== "image/jpeg"
  )
    stop("PILOT_DOWNLOADED_FILE_INVALID");
  const previewMetadata = await sharp(preview, {
    failOn: "error",
    limitInputPixels: VISUAL_LIBRARY_POLICY.maximumPixels,
  }).metadata();
  if (
    previewMetadata.format !== "jpeg" ||
    previewMetadata.width !== current.preview.width ||
    previewMetadata.height !== current.preview.height
  )
    stop("PILOT_DOWNLOADED_FILE_INVALID");
  run.manifest = current;
  run.phase = "FILE_VERIFIED";
  await options.persist(run);
  const beforeLink = graph(await options.api.snapshot(), options.scope);
  unchangedLink(beforeLink, run.productId, run.link);
  if (
    pilotHash(
      JSON.stringify(eligibleProduct(beforeLink, options.scope, run.productId)),
    ) !== run.productHash
  )
    stop("PILOT_PRODUCT_CHANGED");
  await acknowledge(run.identityCommand);
  await acknowledge(run.linkCommand);
  run.phase = "LINK_ACK";
  await options.persist(run);
  const final = graph(await options.api.snapshot(), options.scope);
  if (
    !final.assets.some((a) => same(a, run.asset)) ||
    !final.identities.some((i) => same(i, run.identity)) ||
    !final.links.some((l) => same(l, run.link))
  )
    stop("PILOT_SYNC_READBACK_INVALID");
  run.phase = "AWAITING_MOBILE";
  await options.persist(run);
  return run;
}
export function pilotPushPacket(
  scope: PilotAuthority,
  commands: SyncCommand[],
) {
  return syncPushRequestSchema.parse({
    syncProtocolVersion: 1,
    appVersion: "visual-pilot.v1",
    deviceId: scope.deviceId,
    storeId: scope.storeId,
    commands,
  });
}
