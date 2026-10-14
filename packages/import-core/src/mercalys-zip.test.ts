import { expect, it } from "vitest";
import { inspectMercalysZip } from "./mercalys-zip";
function zip(paths: string[]) {
  const locals: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const path of paths) {
    const name = utf8(path),
      directory = path.endsWith("/"),
      size = directory ? 0 : 1;
    const local = new Uint8Array(30 + name.length + size),
      l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length),
      v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x800, true);
    v.setUint32(20, size, true);
    v.setUint32(24, size, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, offset, true);
    c.set(name, 46);
    locals.push(local);
    central.push(c);
    offset += local.length;
  }
  const length = offset + central.reduce((sum, c) => sum + c.length, 0),
    bytes = new Uint8Array(length + 22);
  let p = 0;
  for (const part of [...locals, ...central]) {
    bytes.set(part, p);
    p += part.length;
  }
  const end = new DataView(bytes.buffer, length);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, paths.length, true);
  end.setUint16(10, paths.length, true);
  end.setUint32(12, length - offset, true);
  end.setUint32(16, offset, true);
  return bytes;
}
const central = (b: Uint8Array) =>
  new DataView(b.buffer).getUint32(b.length - 6, true);
it("keeps member paths and offsets, ignores named macOS metadata and supports a Uint8Array slice", () => {
  const b = zip([
      "Exports/",
      "Exports/ventes.xlsx",
      "casse-é.xlsx",
      "__MACOSX/._ventes.xlsx",
    ]),
    copy = new Uint8Array(b.length + 4);
  copy.set(b, 2);
  const r = inspectMercalysZip(copy.subarray(2, b.length + 2));
  expect(r.files.map((f) => f.path)).toEqual([
    "Exports/ventes.xlsx",
    "casse-é.xlsx",
  ]);
  expect(r.ignored).toEqual(["__MACOSX/._ventes.xlsx"]);
  expect(
    r.files.every((f) => f.compressedSize === 1 && f.uncompressedSize === 1),
  ).toBe(true);
});
it.each([
  "../ventes.xlsx",
  "/ventes.xlsx",
  "C:\\ventes.xlsx",
  "Exports//ventes.xlsx",
  "./ventes.xlsx",
  "Exports/../ventes.xlsx",
  "a\0.xlsx",
])("rejects unsafe path %s before extraction", (path) => {
  expect(() => inspectMercalysZip(zip([path]))).toThrow(
    "MERCALYS_ZIP_UNSAFE_PATH",
  );
});
it.each(["nested.zip", "macro.xlsm", "run.exe"])(
  "refuses unsupported member %s",
  (path) => {
    expect(() => inspectMercalysZip(zip([path]))).toThrow(
      "MERCALYS_ZIP_UNSUPPORTED",
    );
  },
);
it("refuses duplicate normalized/case-folded paths, encryption, symlinks and ZIP64 markers", () => {
  expect(() => inspectMercalysZip(zip(["A.xlsx", "a.xlsx"]))).toThrow(
    "MERCALYS_ZIP_DUPLICATE_PATH",
  );
  const encrypted = zip(["a.xlsx"]);
  new DataView(encrypted.buffer).setUint16(central(encrypted) + 8, 0x801, true);
  expect(() => inspectMercalysZip(encrypted)).toThrow(
    "MERCALYS_ZIP_UNSUPPORTED",
  );
  const link = zip(["a.xlsx"]);
  new DataView(link.buffer).setUint32(central(link) + 38, 0xa0000000, true);
  expect(() => inspectMercalysZip(link)).toThrow("MERCALYS_ZIP_UNSUPPORTED");
  const z64 = zip(["a.xlsx"]);
  new DataView(z64.buffer).setUint32(central(z64) + 24, 0xffffffff, true);
  expect(() => inspectMercalysZip(z64)).toThrow("MERCALYS_ZIP_UNSUPPORTED");
});
it("refuses oversized declarations, too many workbooks, contradictory local headers and truncated containers", () => {
  const big = zip(["a.xlsx"]);
  new DataView(big.buffer).setUint32(central(big) + 24, 21 * 1024 * 1024, true);
  expect(() => inspectMercalysZip(big)).toThrow("MERCALYS_ZIP_LIMIT");
  expect(() =>
    inspectMercalysZip(zip(Array.from({ length: 101 }, (_, i) => `${i}.xlsx`))),
  ).toThrow("MERCALYS_ZIP_LIMIT");
  const mismatch = zip(["a.xlsx"]);
  mismatch[30] = 98;
  expect(() => inspectMercalysZip(mismatch)).toThrow("MERCALYS_ZIP_INVALID");
  expect(() => inspectMercalysZip(zip(["a.xlsx"]).subarray(0, 35))).toThrow();
});

function utf8(text: string) {
  const encoded = encodeURIComponent(text),
    bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(encoded.charCodeAt(i));
  }
  return new Uint8Array(bytes);
}
it("accepts ZIP32 data descriptors and rejects contradictory descriptor sizes", () => {
  const base = zip(["a.xlsx"]),
    start = central(base),
    b = new Uint8Array(base.length + 16);
  b.set(base.subarray(0, start));
  b.set(base.subarray(start), start + 16);
  const v = new DataView(b.buffer);
  v.setUint16(6, 0x808, true);
  v.setUint32(18, 0, true);
  v.setUint32(22, 0, true);
  v.setUint32(start, 0x08074b50, true);
  v.setUint32(start + 8, 1, true);
  v.setUint32(start + 12, 1, true);
  v.setUint16(start + 16 + 8, 0x808, true);
  v.setUint32(b.length - 6, start + 16, true);
  expect(inspectMercalysZip(b).files).toHaveLength(1);
  v.setUint32(start + 8, 2, true);
  expect(() => inspectMercalysZip(b)).toThrow("MERCALYS_ZIP_INVALID");
});
