import { describe, expect, it } from "vitest";
import { pdfJsTextAdapter } from "../src/commercial/pdf-text-adapter.js";
import { commercialPdfFixture } from "./fixtures/commercial-pdf.js";
describe("deterministic commercial PDF page extraction", () => {
  it("preserves page references, literal prices/dates and geometric spans", async () => {
    const bytes = commercialPdfFixture([
      "Tomate: prix < 2.99 EUR - 07/10/2026",
      "Lot: 3 pieces - semaine 42",
    ]);
    const pages = await pdfJsTextAdapter.parse(bytes);
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(pages[0]?.text).toContain("prix < 2.99 EUR - 07/10/2026");
    expect(pages[1]?.text).toContain("Lot: 3 pieces");
    expect(pages[0]?.spans[0]).toMatchObject({
      text: "Tomate: prix < 2.99 EUR - 07/10/2026",
    });
    expect(pages[0]?.spans[0]?.transform).toHaveLength(6);
    expect(pages[0]).toMatchObject({ width: 612, height: 792, warnings: [] });
    expect(await pdfJsTextAdapter.parse(bytes)).toEqual(pages);
  });
  it("preserves French accents, euro symbols and decimal commas as source text", async () => {
    const [page] = await pdfJsTextAdapter.parse(
      commercialPdfFixture(["Pêche jaune: prix < 2,99 € - 07/10/2026"]),
    );
    expect(page?.text).toBe("Pêche jaune: prix < 2,99 € - 07/10/2026");
  });
  it("preserves a page without extractable text with an explicit warning", async () => {
    const [page] = await pdfJsTextAdapter.parse(commercialPdfFixture([""]));
    expect(page).toMatchObject({
      pageNumber: 1,
      text: "",
      spans: [],
      warnings: ["NO_EXTRACTABLE_TEXT"],
    });
  });
  it("rejects invalid bytes and over-limit page counts", async () => {
    await expect(
      pdfJsTextAdapter.parse(new Uint8Array()),
    ).rejects.toMatchObject({ code: "PDF_SIZE_LIMIT" });
    await expect(
      pdfJsTextAdapter.parse(new TextEncoder().encode("not a PDF")),
    ).rejects.toMatchObject({ code: "PDF_INVALID" });
    await expect(
      pdfJsTextAdapter.parse(commercialPdfFixture(Array(101).fill(""))),
    ).rejects.toMatchObject({ code: "PDF_PAGE_LIMIT" });
  });
});
