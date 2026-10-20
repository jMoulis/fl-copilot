import { expect, it } from "vitest";
import { zipSync } from "fflate";
import { createMercalysZipReader } from "./mercalys-zip-reader";
function data() {
  let seed = 123456789;
  return Uint8Array.from({ length: 50000 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  });
}
function central(bytes: Uint8Array) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(bytes.length - 6, true);
}
it.each([0, 6] as const)(
  "extracts stored/Deflate members at level %s and preserves the archive snapshot",
  async (level) => {
    const original = data(),
      archive = zipSync(
        { "exports/ventes.xlsx": original, "casse.xlsx": original },
        { level },
      ),
      reader = createMercalysZipReader(archive);
    archive.fill(0);
    expect(reader.files.map((f) => f.path)).toEqual([
      "exports/ventes.xlsx",
      "casse.xlsx",
    ]);
    expect(await reader.extract("exports/ventes.xlsx")).toEqual(original);
    expect(await reader.extract("casse.xlsx")).toEqual(original);
    expect(Object.isFrozen(reader.files)).toBe(true);
    expect(Object.isFrozen(reader.files[0])).toBe(true);
    await expect(reader.extract("../other.xlsx")).rejects.toThrow(
      "MERCALYS_ZIP_INVALID",
    );
  },
);
it("refuses wrong CRC and actual output longer than its forged declaration", async () => {
  const badCrc = zipSync({ "a.xlsx": data() }, { level: 0 }),
    c = central(badCrc),
    v = new DataView(badCrc.buffer);
  v.setUint32(14, 0, true);
  v.setUint32(c + 16, 0, true);
  await expect(
    createMercalysZipReader(badCrc).extract("a.xlsx"),
  ).rejects.toThrow("MERCALYS_ZIP_CORRUPT");
  const expanded = zipSync({ "a.xlsx": data() }, { level: 6 }),
    cv = central(expanded),
    view = new DataView(expanded.buffer);
  view.setUint32(22, 1000, true);
  view.setUint32(cv + 24, 1000, true);
  await expect(
    createMercalysZipReader(expanded).extract("a.xlsx"),
  ).rejects.toThrow("MERCALYS_ZIP_LIMIT");
});
it("checks cancellation before allocation and between scheduler yields, then can reread the same original", async () => {
  const original = data(),
    reader = createMercalysZipReader(zipSync({ "a.xlsx": original })),
    signal = { aborted: true };
  await expect(reader.extract("a.xlsx", { signal })).rejects.toThrow(
    "MERCALYS_ZIP_CANCELLED",
  );
  signal.aborted = false;
  await expect(
    reader.extract("a.xlsx", {
      signal,
      pause: async () => {
        signal.aborted = true;
      },
    }),
  ).rejects.toThrow("MERCALYS_ZIP_CANCELLED");
  expect(await reader.extract("a.xlsx")).toEqual(original);
});
it("refuses a corrupt Deflate payload and never returns partially decoded bytes", async () => {
  const archive = zipSync({ "a.xlsx": data() }),
    reader = createMercalysZipReader(archive),
    offset = reader.files[0]!.compressedOffset;
  archive[offset] = 255;
  await expect(
    createMercalysZipReader(archive).extract("a.xlsx"),
  ).rejects.toThrow("MERCALYS_ZIP_CORRUPT");
});

it.each([0, 6] as const)(
  "verifies an empty ZIP member with compression level %i without hiding a valid sibling",
  async (level) => {
    const good = new Uint8Array([1, 2, 3]),
      reader = createMercalysZipReader(
        zipSync(
          { "empty.xlsx": new Uint8Array(), "good.xlsx": good },
          { level },
        ),
      );
    expect(reader.files.map((file) => file.path)).toEqual([
      "empty.xlsx",
      "good.xlsx",
    ]);
    expect(await reader.extract("empty.xlsx")).toEqual(new Uint8Array());
    expect(await reader.extract("good.xlsx")).toEqual(good);
  },
);

it("still verifies CRC for empty members instead of treating zero bytes as trusted", async () => {
  const raw = zipSync(
      {
        "empty.xlsx": new Uint8Array(),
        "good.xlsx": new Uint8Array([1, 2, 3]),
      },
      { level: 0 },
    ),
    view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  view.setUint32(14, 1, true);
  view.setUint32(central(raw) + 16, 1, true);
  const reader = createMercalysZipReader(raw);
  await expect(reader.extract("empty.xlsx")).rejects.toThrow(
    "MERCALYS_ZIP_CORRUPT",
  );
  expect(await reader.extract("good.xlsx")).toEqual(new Uint8Array([1, 2, 3]));
});
