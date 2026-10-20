import { expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { assertSafeXlsxContainer } from "./mercalys-zip-reader";
const parts = () => ({
  "[Content_Types].xml": strToU8("<Types/>"),
  "xl/workbook.xml": strToU8("<workbook/>"),
  "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
});
it.each([0, 6] as const)(
  "bounds and verifies every workbook member at compression level %s",
  async (level) => {
    await expect(
      assertSafeXlsxContainer(zipSync(parts(), { level })),
    ).resolves.toBeUndefined();
  },
);
it("rejects a renamed archive and a macro workbook before spreadsheet parsing", async () => {
  await expect(
    assertSafeXlsxContainer(zipSync({ "report.xlsx": strToU8("other zip") })),
  ).rejects.toThrow("UNSUPPORTED");
  await expect(
    assertSafeXlsxContainer(
      zipSync({ ...parts(), "xl/vbaProject.bin": new Uint8Array([1]) }),
    ),
  ).rejects.toThrow("UNSUPPORTED");
});
it("does not exempt macOS-looking workbook members from expanded-byte verification", async () => {
  const bytes = zipSync(
    { ...parts(), "__MACOSX/._ignored": new Uint8Array([1, 2, 3]) },
    { level: 0 },
  );
  const view = new DataView(bytes.buffer),
    central = view.getUint32(bytes.length - 6, true);
  bytes[central - 1] ^= 1;
  await expect(assertSafeXlsxContainer(bytes)).rejects.toThrow("CORRUPT");
});
it("refuses declared expansion limits and an inflated size that contradicts a valid-looking directory", async () => {
  const oversized = zipSync(
    { ...parts(), "xl/sharedStrings.xml": new Uint8Array(30_000).fill(65) },
    { level: 6 },
  );
  await expect(assertSafeXlsxContainer(oversized)).rejects.toThrow("LIMIT");
  const bytes = zipSync(parts(), { level: 6 }),
    view = new DataView(bytes.buffer),
    central = view.getUint32(bytes.length - 6, true);
  view.setUint32(22, 1, true);
  view.setUint32(central + 24, 1, true);
  await expect(assertSafeXlsxContainer(bytes)).rejects.toThrow("LIMIT");
});
it("retains cancellation during bounded workbook inspection", async () => {
  await expect(
    assertSafeXlsxContainer(zipSync(parts()), { aborted: true }),
  ).rejects.toThrow("CANCELLED");
});
