import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { sourceOriginalHash } from "../documents/source-original-hash";
const state = vi.hoisted(() => ({
  root: "",
  failWrite: false,
  failMove: false,
  writes: 0,
}));
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs"),
    urls = await import("node:url");
  class File {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
    get path() {
      return urls.fileURLToPath(this.uri);
    }
    get exists() {
      return fs.existsSync(this.path);
    }
    get size() {
      return this.exists ? fs.statSync(this.path).size : 0;
    }
    create() {
      fs.writeFileSync(this.path, new Uint8Array(), { flag: "wx" });
    }
    write(text: string) {
      state.writes++;
      fs.writeFileSync(this.path, state.failWrite ? text.slice(0, 4) : text);
      if (state.failWrite) throw Error("interrupted write");
    }
    async bytes() {
      return new Uint8Array(fs.readFileSync(this.path));
    }
    move(target: File) {
      if (state.failMove) throw Error("interrupted move");
      fs.renameSync(this.path, target.path);
      this.uri = target.uri;
    }
    delete() {
      fs.unlinkSync(this.path);
    }
  }
  class Directory extends File {
    create() {
      fs.mkdirSync(this.path, { recursive: true });
    }
  }
  return {
    File,
    Directory,
    Paths: {
      document: {
        get uri() {
          return urls.pathToFileURL(state.root).href;
        },
      },
    },
  };
});
vi.mock("expo-crypto", async () => {
  const crypto = await import("node:crypto");
  return {
    randomUUID: crypto.randomUUID,
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digest: async (_algorithm: string, bytes: Uint8Array) =>
      new Uint8Array(crypto.createHash("sha256").update(bytes).digest()).buffer,
  };
});
import { nativeReceiptViewsIntakeStorage } from "./receipt-views-intake";
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "fl-native-bundle-"));
  state.failWrite = false;
  state.failMove = false;
  state.writes = 0;
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
const text =
  '{"schemaVersion":"receipt-photo-bundle.v1","mode":"ONE_RECEIPT_MULTIPLE_PHOTOS","views":[]}';
it("writes the actual native bundle method through a temporary file and reuses the same verified copy", async () => {
  const id = randomUUID(),
    first = await nativeReceiptViewsIntakeStorage.writeBundle(text, id);
  expect(first.checksum).toBe(sourceOriginalHash(text));
  expect(readFileSync(fileURLToPath(first.localUri), "utf8")).toBe(text);
  expect(await nativeReceiptViewsIntakeStorage.writeBundle(text, id)).toEqual(
    first,
  );
  expect(state.writes).toBe(1);
  expect(readdirSync(join(state.root, "waste-receipts"))).toEqual([
    `${id}.flreceipt`,
  ]);
});
it.each(["WRITE", "MOVE"] as const)(
  "retains originals and allows retry after %s interruption without exposing a partial final bundle",
  async (failure) => {
    const id = randomUUID(),
      original = join(state.root, "original.bin");
    writeFileSync(original, "source retained");
    state.failWrite = failure === "WRITE";
    state.failMove = failure === "MOVE";
    await expect(
      nativeReceiptViewsIntakeStorage.writeBundle(text, id),
    ).rejects.toThrow("interrupted");
    expect(readdirSync(join(state.root, "waste-receipts"))).toEqual([]);
    expect(readFileSync(original, "utf8")).toBe("source retained");
    state.failWrite = false;
    state.failMove = false;
    expect(
      (await nativeReceiptViewsIntakeStorage.writeBundle(text, id)).checksum,
    ).toBe(sourceOriginalHash(text));
  },
);
it("does not overwrite or delete a contradictory existing final bundle", async () => {
  const id = randomUUID(),
    first = await nativeReceiptViewsIntakeStorage.writeBundle(text, id);
  writeFileSync(fileURLToPath(first.localUri), "contradictory existing source");
  await expect(
    nativeReceiptViewsIntakeStorage.writeBundle(text, id),
  ).rejects.toThrow("COPILOT_RECEIPT_PHOTO_NOT_SAVED");
  expect(readFileSync(fileURLToPath(first.localUri), "utf8")).toBe(
    "contradictory existing source",
  );
});
