import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECEIPT_PHOTO_BUNDLE_VERSION,
  serializeReceiptPhotoBundle,
} from "@fl-copilot/domain";
import { sourceOriginalHash } from "../documents/source-original-hash";
import { nativeReceiptViewsIntakeStorage as files } from "./receipt-views-intake";

const native = vi.hoisted(() => ({
  root: "",
  beforeMove: undefined as (() => Promise<void>) | undefined,
  failMove: false,
  failMoveAcknowledgement: false,
}));
vi.mock("expo-crypto", async () => {
  const crypto = await import("node:crypto");
  return {
    randomUUID: crypto.randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digest: async (_: unknown, bytes: Uint8Array) =>
      new Uint8Array(crypto.createHash("sha256").update(bytes).digest()).buffer,
  };
});
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs"),
    path = await import("node:path"),
    url = await import("node:url");
  const local = (parts: (string | { uri: string })[]) =>
    path.join(
      ...parts.map((part) => {
        const value = typeof part === "string" ? part : part.uri;
        return value.startsWith("file:") ? url.fileURLToPath(value) : value;
      }),
    );
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(local(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    get size() {
      return fs.statSync(url.fileURLToPath(this.uri)).size;
    }
    create() {
      fs.writeFileSync(url.fileURLToPath(this.uri), "", { flag: "wx" });
    }
    write(text: string) {
      fs.writeFileSync(url.fileURLToPath(this.uri), text);
    }
    async bytes() {
      return new Uint8Array(fs.readFileSync(url.fileURLToPath(this.uri)));
    }
    async base64() {
      return fs.readFileSync(url.fileURLToPath(this.uri)).toString("base64");
    }
    async move(to: File) {
      await Promise.resolve();
      await native.beforeMove?.();
      if (native.failMove) throw Error("NATIVE_MOVE_FAILED");
      if (to.exists) throw Error("DESTINATION_EXISTS");
      fs.renameSync(url.fileURLToPath(this.uri), url.fileURLToPath(to.uri));
      this.uri = to.uri;
      if (native.failMoveAcknowledgement) throw Error("MOVE_ACK_LOST");
    }
    delete() {
      fs.unlinkSync(url.fileURLToPath(this.uri));
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(local(parts)).href;
    }
    create() {
      fs.mkdirSync(url.fileURLToPath(this.uri), { recursive: true });
    }
  }
  return {
    File,
    Directory,
    Paths: {
      get document() {
        return url.pathToFileURL(native.root).href;
      },
    },
  };
});
beforeEach(async () => {
  native.root = await mkdtemp(join(tmpdir(), "fl-receipt-native-"));
  native.beforeMove = undefined;
  native.failMove = false;
  native.failMoveAcknowledgement = false;
});
afterEach(async () => {
  await rm(native.root, { recursive: true, force: true });
});
function bundle() {
  return serializeReceiptPhotoBundle({
    schemaVersion: RECEIPT_PHOTO_BUNDLE_VERSION,
    mode: "ONE_RECEIPT_MULTIPLE_PHOTOS",
    views: [1, 2].map((n) => {
      const bytes = new Uint8Array([255, 216, 255, n]);
      return {
        mimeType: "image/jpeg",
        dataBase64: Buffer.from(bytes).toString("base64"),
        sizeBytes: bytes.length,
        checksum: sourceOriginalHash(bytes),
      };
    }),
  });
}

it("waits for the actual native bundle move before exposing its final URI and preserves byte identity on retry", async () => {
  const text = bundle(),
    id = randomUUID();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  native.beforeMove = async () => {
    entered();
    await gate;
  };
  let settled = false;
  const saving = files.writeBundle(text, id);
  void saving.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    const entries = await readdir(join(native.root, "waste-receipts"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/\.part$/);
  } finally {
    release();
  }
  const result = await saving;
  expect(await readFile(fileURLToPath(result.localUri), "utf8")).toBe(text);
  expect(result.checksum).toBe(sourceOriginalHash(text));
  expect(await files.writeBundle(text, id)).toEqual(result);
  expect(await readdir(join(native.root, "waste-receipts"))).toEqual([
    `${id}.flreceipt`,
  ]);
  const parsed = await files.read(result.localUri);
  expect(Buffer.from(parsed.dataBase64, "base64").toString("utf8")).toBe(text);
});

it("rejects a late bundle move failure, keeps source photos intact and retries without a stale partial", async () => {
  const text = bundle(),
    id = randomUUID(),
    photo = join(native.root, "original-photo.jpg");
  const bytes = new Uint8Array([255, 216, 255, 7]);
  await writeFile(photo, bytes);
  native.failMove = true;
  await expect(files.writeBundle(text, id)).rejects.toThrow(
    "NATIVE_MOVE_FAILED",
  );
  expect(await readdir(join(native.root, "waste-receipts"))).toEqual([]);
  expect(new Uint8Array(await readFile(photo))).toEqual(bytes);
  native.failMove = false;
  const saved = await files.writeBundle(text, id);
  expect(await readFile(fileURLToPath(saved.localUri), "utf8")).toBe(text);
});

it("preserves an existing contradictory immutable bundle instead of replacing it", async () => {
  const text = bundle(),
    id = randomUUID(),
    file = await files.writeBundle(text, id);
  await writeFile(fileURLToPath(file.localUri), "another immutable capture");
  await expect(files.writeBundle(text, id)).rejects.toThrow(
    "COPILOT_RECEIPT_PHOTO_NOT_SAVED",
  );
  expect(await readFile(fileURLToPath(file.localUri), "utf8")).toBe(
    "another immutable capture",
  );
});

it("retains a completed multiphoto bundle when acknowledgement is lost and reuses it without replacing bytes", async () => {
  const text = bundle(),
    id = randomUUID();
  native.failMoveAcknowledgement = true;
  await expect(files.writeBundle(text, id)).rejects.toThrow("MOVE_ACK_LOST");
  const path = join(native.root, "waste-receipts", `${id}.flreceipt`);
  expect(await readFile(path, "utf8")).toBe(text);
  native.failMoveAcknowledgement = false;
  const saved = await files.writeBundle(text, id);
  expect(fileURLToPath(saved.localUri)).toBe(path);
  expect(saved.checksum).toBe(sourceOriginalHash(text));
});
