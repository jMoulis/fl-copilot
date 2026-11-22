import { afterEach, expect, it, vi } from "vitest";
import {
  procurementNativeOriginals,
  retainProcurementJson,
} from "./procurement-native-originals";
import { sourceOriginalHash } from "./source-original-hash";
const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///new/Documents" },
  Directory: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((p) => (typeof p === "string" ? p : p.uri))
        .join("/");
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((p) => (typeof p === "string" ? p : p.uri))
        .join("/");
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    async bytes() {
      return files.get(this.uri)!;
    }
    write(bytes: Uint8Array) {
      files.set(this.uri, bytes);
    }
  },
}));
afterEach(() => files.clear());
it("retains immutable bytes, survives container relocation, and never overwrites a changed original", async () => {
  const bytes = new TextEncoder().encode('{"pdv":"09083"}');
  files.set("file:///picker.json", bytes);
  const check = vi.fn();
  const first = await retainProcurementJson("file:///picker.json", check);
  expect(first.checksum).toBe(sourceOriginalHash(bytes));
  expect(files.get(first.localUri)).toEqual(bytes);
  expect(await retainProcurementJson("file:///picker.json", check)).toEqual(
    first,
  );
  expect(
    await procurementNativeOriginals.read(
      first.localUri.replace("/new/", "/old/"),
    ),
  ).toEqual(bytes);
  files.set(first.localUri, new Uint8Array([1]));
  await expect(
    retainProcurementJson("file:///picker.json", check),
  ).rejects.toThrow("PROCUREMENT_SOURCE_CHANGED");
  expect(files.get(first.localUri)).toEqual(new Uint8Array([1]));
});
it("rejects missing, oversized or traversing inputs before publication", async () => {
  await expect(
    retainProcurementJson("file:///missing", () => {}),
  ).rejects.toThrow();
  files.set("file:///big", new Uint8Array(10 * 1024 * 1024 + 1));
  await expect(retainProcurementJson("file:///big", () => {})).rejects.toThrow(
    "PROCUREMENT_SOURCE_SIZE_INVALID",
  );
  for (const uri of [
    "https://example.com/source",
    "file:///../source",
    "file:///%2e%2e/source",
  ]) {
    await expect(procurementNativeOriginals.read(uri)).rejects.toThrow(
      "PROCUREMENT_ORIGINAL_REQUIRED",
    );
  }
});
