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
  failMoveAcknowledgement: false,
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
    write(text: string | Uint8Array) {
      state.writes++;
      fs.writeFileSync(this.path, state.failWrite ? text.slice(0, 4) : text);
      if (state.failWrite) throw Error("interrupted write");
    }
    async bytes() {
      return new Uint8Array(fs.readFileSync(this.path));
    }
    async move(target: File) {
      await Promise.resolve();
      if (state.failMove) throw Error("interrupted move");
      fs.renameSync(this.path, target.path);
      this.uri = target.uri;
      if (state.failMoveAcknowledgement) throw Error("MOVE_ACK_LOST");
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
import { nativeMercalysZipStorage } from "./mercalys-zip-capture";
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "fl-native-zip-"));
  state.failWrite = false;
  state.failMove = false;
  state.failMoveAcknowledgement = false;
  state.writes = 0;
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
const bytes = new TextEncoder().encode("verified member bytes");
it("retains the actual member through a verified temporary file and reuses its final bytes", async () => {
  const id = randomUUID(),
    first = await nativeMercalysZipStorage.member(bytes, id);
  expect(first.checksum).toBe(sourceOriginalHash(bytes));
  expect(await nativeMercalysZipStorage.member(bytes, id)).toEqual(first);
  expect(state.writes).toBe(1);
  expect(readdirSync(join(state.root, "mercalys-batches"))).toEqual([
    `${id}.xlsx`,
  ]);
  expect(readFileSync(fileURLToPath(first.localUri))).toEqual(
    Buffer.from(bytes),
  );
});
it.each(["WRITE", "MOVE"])(
  "retains original bytes and resumes after %s without exposing a partial final member",
  async (failure) => {
    const id = randomUUID(),
      original = join(state.root, "source.zip");
    writeFileSync(original, "immutable archive");
    state.failWrite = failure === "WRITE";
    state.failMove = failure === "MOVE";
    await expect(nativeMercalysZipStorage.member(bytes, id)).rejects.toThrow(
      "interrupted",
    );
    expect(readdirSync(join(state.root, "mercalys-batches"))).toEqual([]);
    expect(readFileSync(original, "utf8")).toBe("immutable archive");
    state.failWrite = false;
    state.failMove = false;
    expect((await nativeMercalysZipStorage.member(bytes, id)).checksum).toBe(
      sourceOriginalHash(bytes),
    );
  },
);
it("does not replace or delete a contradictory final member", async () => {
  const id = randomUUID(),
    file = await nativeMercalysZipStorage.member(bytes, id);
  writeFileSync(fileURLToPath(file.localUri), "contradictory original");
  await expect(nativeMercalysZipStorage.member(bytes, id)).rejects.toThrow(
    "MERCALYS_ZIP_MEMBER_CHANGED",
  );
  expect(readFileSync(fileURLToPath(file.localUri), "utf8")).toBe(
    "contradictory original",
  );
});

it("keeps a fully installed ZIP member after lost acknowledgement and reuses its stable identity", async () => {
  const id = randomUUID();
  state.failMoveAcknowledgement = true;
  await expect(nativeMercalysZipStorage.member(bytes, id)).rejects.toThrow(
    "MOVE_ACK_LOST",
  );
  const path = join(state.root, "mercalys-batches", `${id}.xlsx`);
  expect(readFileSync(path)).toEqual(Buffer.from(bytes));
  state.failMoveAcknowledgement = false;
  const retained = await nativeMercalysZipStorage.member(bytes, id);
  expect(fileURLToPath(retained.localUri)).toBe(path);
  expect(state.writes).toBe(1);
});
