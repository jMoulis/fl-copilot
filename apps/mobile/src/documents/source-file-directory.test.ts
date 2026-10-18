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
