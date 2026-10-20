import { expect, it } from "vitest";
import { sourceFileDirectory } from "./source-file-directory";
it("relocates restored copies only inside their fixed private folder", () => {
  expect(
    sourceFileDirectory(
      "file:///old/Documents/source-restorations/11111111-1111-4111-8111-111111111111.pdf",
      "commercial-pdfs",
    ),
  ).toBe("source-restorations");
  expect(
    sourceFileDirectory(
      "file:///old/Documents/source-restorations/11111111-1111-4111-8111-111111111111.xlsx",
      "mercalys-imports",
    ),
  ).toBe("source-restorations");
  expect(
    sourceFileDirectory(
      "file:///old/Documents/commercial-pdfs/source.pdf",
      "commercial-pdfs",
    ),
  ).toBe("commercial-pdfs");
  expect(
    sourceFileDirectory(
      "file:///old/Documents/source-restorations/../../other.pdf",
      "commercial-pdfs",
    ),
  ).toBe("commercial-pdfs");
});
it("relocates recovered originals and ordered views through their fixed scoped folders", () => {
  const scope =
    "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
  for (const file of [
    `original-${"a".repeat(64)}.pdf`,
    `view-${"b".repeat(64)}.heic`,
  ])
    expect(
      sourceFileDirectory(
        `file:///old/Documents/source-originals/${scope}/${file}`,
        "waste-receipts",
      ),
    ).toBe(`source-originals/${scope}`);
  expect(
    sourceFileDirectory(
      "file:///old/Documents/mercalys-batches/11111111-1111-4111-8111-111111111111.xlsx",
      "mercalys-imports",
    ),
  ).toBe("mercalys-batches");
  for (const suffix of [
    `../${"a".repeat(64)}.pdf`,
    `original-${"a".repeat(64)}.pdf?url=other`,
    `view-${"a".repeat(64)}.html`,
  ])
    expect(
      sourceFileDirectory(
        `file:///old/Documents/source-originals/${scope}/${suffix}`,
        "waste-receipts",
      ),
    ).toBe("waste-receipts");
});
