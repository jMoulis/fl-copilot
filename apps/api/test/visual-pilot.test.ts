import { randomUUID, createHash } from "node:crypto";
import { rm, writeFile, symlink, copyFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, it, expect, vi } from "vitest";
import { visualPilotFixture } from "../../../scripts/test-visual-pilot-fixtures";
import {
  createPilotRun,
  inspectPilot,
  inspectPilotItem,
  pilotHash,
  runPilotImport,
  recordPilotMobileReview,
  pilotInputSchema,
} from "../src/development/visual-pilot-import";
const roots: string[] = [];
async function fixture() {
  const f = await visualPilotFixture();
  roots.push(f.root);
  return f;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("measures real decoded RGBA bytes and evidence hashes; preparation is never approval", async () => {
  const s = await fixture(),
    result = await inspectPilot(s.root, s.input);
  expect(result.status).toBe("PREPARED_NOT_APPROVED");
  expect(result.items[0]).toMatchObject({
    status: "READY_FOR_HUMAN_REVIEW",
    descriptor: {
      contentHash: `sha256:${createHash("sha256").update(s.bytes).digest("hex")}`,
      width: 16,
      height: 16,
      sizeBytes: s.bytes.length,
      mimeType: "image/png",
    },
  });
  expect(JSON.stringify(result)).not.toContain('"APPROVED"');
});
it.each(["file", "provenance", "generation", "productId"] as const)(
  "blocks missing %s without write",
  async (field) => {
    const s = await fixture();
    s.input.items[0]![field] = null;
    expect((await inspectPilot(s.root, s.input)).items[0]?.status).toBe(
      "BLOCKED",
    );
    await expect(
      createPilotRun({
        root: s.root,
        input: s.input,
        visualKey: "tomato_round",
        scope: s.scope,
        api: s.api,
        review: async () => {
          throw Error("SHOULD_NOT_REVIEW");
        },
      }),
    ).rejects.toThrow("PILOT_");
  },
);
it("rejects approval flags in incoming manifest", async () => {
  const s = await fixture();
  expect(() =>
    pilotInputSchema.parse({ ...s.input, approval: { status: "APPROVED" } }),
  ).toThrow();
});
it.each([
  "../escape.png",
  "/tmp/escape.png",
  "reference/style_reference_only.png",
])("rejects non asset path %s", async (file) => {
  const s = await fixture();
  await expect(
    inspectPilotItem(s.root, { ...s.input.items[0]!, file }),
  ).rejects.toThrow("PILOT_");
});
it("rejects symlink source, opaque PNG, false transform chain and uncertain provenance", async () => {
  const s = await fixture(),
    item = s.input.items[0]!;
  await symlink(join(s.root, "test-only.png"), join(s.root, "alias.png"));
  await expect(
    inspectPilotItem(s.root, { ...item, file: "alias.png" }),
  ).rejects.toThrow("PILOT_FILE_INVALID");
  await writeFile(
    join(s.root, "opaque.png"),
    await sharp({
      create: { width: 8, height: 8, channels: 4, background: "white" },
    })
      .png()
      .toBuffer(),
  );
  await expect(
    inspectPilotItem(s.root, { ...item, file: "opaque.png" }),
  ).rejects.toThrow("PILOT_REAL_ALPHA_REQUIRED");
  await expect(
    inspectPilotItem(s.root, {
      ...item,
      generation: {
        ...item.generation!,
        transformations: [
          {
            tool: "test",
            kind: "test",
            at: s.f.at,
            inputHash: pilotHash("wrong"),
            outputHash: pilotHash(s.bytes),
          },
        ],
      },
    }),
  ).rejects.toThrow("PILOT_TRANSFORM_CHAIN_INVALID");
  await expect(
    inspectPilotItem(s.root, {
      ...item,
      provenance: {
        type: "AI_GENERATED",
        provider: "unknown",
        model: "unknown",
        promptVersion: "todo",
      },
    }),
  ).rejects.toThrow("PILOT_PROVENANCE_MISSING");
});
it("requires active manager and preserves any existing manual link including tombstone", async () => {
  const s = await fixture(),
    review = vi.fn(async () => "wrong"),
    args = {
      root: s.root,
      input: s.input,
      visualKey: "tomato_round" as const,
      scope: s.scope,
      api: s.api,
      review,
    };
  s.snapshot.store.role = "STAFF";
  await expect(createPilotRun(args)).rejects.toThrow(
    "PILOT_STORE_AUTHORITY_REQUIRED",
  );
  s.snapshot.store.role = "MANAGER";
  s.snapshot.entities.productVisualLinks = [{ ...s.f.link, deletedAt: s.f.at }];
  await expect(createPilotRun(args)).rejects.toThrow(
    "PILOT_EXISTING_LINK_REQUIRES_MANUAL_REVIEW",
  );
  expect(review).not.toHaveBeenCalled();
});
it("never writes before explicit review and records only a generic non exact link after test review", async () => {
  const s = await fixture(),
    push = vi.fn(s.api.push);
  s.api.push = push;
  const args = {
    root: s.root,
    input: s.input,
    visualKey: "tomato_round" as const,
    scope: s.scope,
    api: s.api,
  };
  await expect(
    createPilotRun({ ...args, review: async () => "" }),
  ).rejects.toThrow("PILOT_HUMAN_APPROVAL_REQUIRED");
  expect(push).not.toHaveBeenCalled();
  const run = await createPilotRun({
    ...args,
    review: async (d) => d.digest,
    now: () => s.f.at,
  });
  expect(run.link).toMatchObject({
    linkType: "INHERITED_GENERIC",
    overrideAssetId: null,
  });
  expect(run.identity.specificity).toBe("GENERIC");
  expect(push).not.toHaveBeenCalled();
  run.review.digest = pilotHash("tampered");
  await expect(
    runPilotImport({ ...args, run, persist: async () => {} }),
  ).rejects.toThrow("PILOT_RUN_BINDING_INVALID");
  expect(push).not.toHaveBeenCalled();
});
it.each(["banana_cavendish", "avocado_hass"] as const)(
  "blocks %s until first real mobile review",
  async (visualKey) => {
    const s = await fixture();
    await expect(
      createPilotRun({
        root: s.root,
        input: s.input,
        visualKey,
        scope: s.scope,
        api: s.api,
        review: async (d) => d.digest,
      }),
    ).rejects.toThrow("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
  },
);
it("stops changed bytes or actor before write and saves stable commands before an uncertain request", async () => {
  const s = await fixture(),
    args = { root: s.root, input: s.input, scope: s.scope, api: s.api };
  const run = await createPilotRun({
    ...args,
    visualKey: "tomato_round",
    review: async (d) => d.digest,
    now: () => s.f.at,
  });
  await expect(
    runPilotImport({
      ...args,
      scope: { ...s.scope, actorId: randomUUID() },
      run,
      persist: async () => {},
    }),
  ).rejects.toThrow("PILOT_RUN_SCOPE_CHANGED");
  const saved: string[] = [],
    sent: string[] = [];
  s.api.push = async (commands) => {
    sent.push(commands[0]!.commandId);
    expect(saved).toContain(commands[0]!.commandId);
    throw Error("uncertain response");
  };
  for (let i = 0; i < 2; i++)
    await expect(
      runPilotImport({
        ...args,
        run,
        persist: async (r) => {
          saved.push(r.assetCommand!.commandId);
        },
      }),
    ).rejects.toThrow("uncertain response");
  expect(new Set(sent).size).toBe(1);
  await writeFile(join(s.root, "prompt.txt"), "changed evidence");
  await expect(
    runPilotImport({ ...args, run, persist: async () => {} }),
  ).rejects.toThrow("PILOT_APPROVED_INPUT_CHANGED");
});
it("does not mistake an imported image for a phone screenshot", async () => {
  const s = await fixture(),
    run = await createPilotRun({
      root: s.root,
      input: s.input,
      scope: s.scope,
      api: s.api,
      visualKey: "tomato_round",
      review: async (d) => d.digest,
    });
  await copyFile(join(s.root, "test-only.png"), join(s.root, "phone.png"));
  await expect(
    recordPilotMobileReview({
      api: s.api,
      run,
      scope: s.scope,
      screenshotRoot: s.root,
      screenshotFile: "phone.png",
      confirm: async (d) => d,
    }),
  ).rejects.toThrow("PILOT_FIRST_MOBILE_REVIEW_REQUIRED");
});
it("reuses an approved AI hash/identity but never relabels a user upload", async () => {
  const s = await fixture(),
    args = {
      root: s.root,
      input: s.input,
      scope: s.scope,
      api: s.api,
      visualKey: "tomato_round" as const,
      review: async (d: { digest: string }) => d.digest,
    };
  const first = await createPilotRun(args);
  s.snapshot.entities.visualAssets = [first.asset];
  s.snapshot.entities.visualIdentities = [first.identity];
  const again = await createPilotRun(args);
  expect(again.assetCommand).toBeNull();
  expect(again.identityCommand).toBeNull();
  expect(again.identity.id).toBe(first.identity.id);
  s.snapshot.entities.visualAssets = [
    { ...first.asset, provenance: s.f.asset.provenance },
  ];
  await expect(createPilotRun(args)).rejects.toThrow(
    "PILOT_EXISTING_ASSET_REQUIRES_REVIEW",
  );
});
it("blocks a conflict ACK and never uploads to an unexpected lease destination", async () => {
  const s = await fixture(),
    args = { root: s.root, input: s.input, scope: s.scope, api: s.api },
    run = await createPilotRun({
      ...args,
      visualKey: "tomato_round",
      review: async (d) => d.digest,
    });
  s.api.push = async (commands) => ({
    serverTime: s.f.at,
    results: commands.map((c) => ({
      commandId: c.commandId,
      entityId: c.entityId,
      entityType: c.entityType,
      status: "CONFLICT",
    })),
  });
  await expect(
    runPilotImport({ ...args, run, persist: async () => {} }),
  ).rejects.toThrow("PILOT_CONFLICT_REQUIRES_REVIEW");
  s.api.push = async (commands) => ({
    serverTime: s.f.at,
    results: commands.map((c) => ({
      commandId: c.commandId,
      entityId: c.entityId,
      entityType: c.entityType,
      status: "APPLIED",
      remoteEntity: c.payload,
    })),
  });
  const uploadId = randomUUID();
  s.api.init = async () => ({
    state: "UPLOAD_REQUIRED",
    uploadId,
    uploadUrl: `https://attacker.invalid/?pathname=stores/${s.f.storeId}/visual-staging/${uploadId}`,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    headers: { "content-type": "image/png" },
    manifest: null,
  });
  const put = vi.fn(s.api.put);
  s.api.put = put;
  await expect(
    runPilotImport({ ...args, run, persist: async () => {} }),
  ).rejects.toThrow("PILOT_UPLOAD_LEASE_INVALID");
  expect(put).not.toHaveBeenCalled();
});
