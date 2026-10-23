import { beforeEach, expect, it, vi } from "vitest";
import { readRetainedMercalysBytes } from "./read-retained-mercalys";
import { localOperationFailureCode } from "../observability/local-operation-failure";
const p = vi.hoisted(() => ({
  files: new Map<string, Uint8Array<ArrayBuffer>>(),
  opened: [] as string[],
}));
vi.mock("expo-file-system", () => ({
  Paths: { document: "file:///new/Documents" },
  File: class {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
      p.opened.push(this.uri);
    }
    get exists() {
      return p.files.has(this.uri);
    }
    async bytes() {
      return p.files.get(this.uri)!;
    }
  },
}));
const id = "11111111-1111-4111-8111-111111111111";
const bytes = new Uint8Array([1, 2, 3]).slice();
beforeEach(() => {
  p.files.clear();
  p.opened.length = 0;
});
it("reads the retained address directly when it still exists", async () => {
  const uri = `file:///old/Documents/mercalys-batches/${id}.xlsx`;
  p.files.set(uri, bytes);
  expect(await readRetainedMercalysBytes(uri)).toEqual(bytes);
  expect(p.opened).toEqual([uri]);
});
it.each(["mercalys-batches", "mercalys-imports", "source-restorations"])(
  "reads the same immutable %s filename in the current app container",
  async (folder) => {
    const old = `file:///old/Documents/${folder}/${id}.xlsx`;
    const current = `file:///new/Documents/${folder}/${id}.xlsx`;
    p.files.set(current, bytes);
    expect(await readRetainedMercalysBytes(old)).toEqual(bytes);
    expect(p.opened).toEqual([old, current]);
    expect(p.files.size).toBe(1);
  },
);
it("preserves the complete scoped original directory when following a relocation", async () => {
  const relative = `source-originals/${id}/${id}/${id}/original-${"a".repeat(64)}.xlsx`;
  p.files.set(`file:///new/Documents/${relative}`, bytes);
  expect(
    await readRetainedMercalysBytes(`file:///old/Documents/${relative}`),
  ).toEqual(bytes);
});
it.each([
  `file:///old/other/${id}.xlsx`,
  "file:///old/Documents/mercalys-batches/user-file.xlsx",
  `file:///old/Documents/../mercalys-batches/${id}.xlsx`,
  `file:///old/Documents/%2e%2e/mercalys-batches/${id}.xlsx`,
  `https://example.test/mercalys-batches/${id}.xlsx`,
])(
  "does not search outside the retained private folder for %s",
  async (uri) => {
    p.files.set(`file:///new/Documents/mercalys-batches/${id}.xlsx`, bytes);
    const failure = await readRetainedMercalysBytes(uri).catch((e) => e);
    expect(localOperationFailureCode(failure)).toBe("LOCAL_FILE_MISSING");
    expect(p.opened).toEqual(
      uri.includes("%") || uri.includes("..") || !uri.startsWith("file://")
        ? []
        : [uri],
    );
  },
);
it("reports a fixed missing-file category when neither retained address exists", async () => {
  const failure = await readRetainedMercalysBytes(
    `file:///old/Documents/mercalys-batches/${id}.xlsx`,
  ).catch((e) => e);
  expect(localOperationFailureCode(failure)).toBe("LOCAL_FILE_MISSING");
  expect(String(failure)).not.toContain("file://");
  expect(p.files.size).toBe(0);
});
