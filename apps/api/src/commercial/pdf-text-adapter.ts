import {
  commercialPdfPageSchema,
  type CommercialPdfPage,
} from "@fl-copilot/domain";

export const COMMERCIAL_PDF_PARSER_VERSION = "pdfjs.text.v1.6.4.299";
export const COMMERCIAL_PDF_MAX_PAGES = 100;
export class CommercialPdfError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CommercialPdfError";
  }
}
export interface CommercialPdfTextAdapter {
  parse(bytes: Uint8Array): Promise<CommercialPdfPage[]>;
}
export const pdfJsTextAdapter: CommercialPdfTextAdapter = {
  async parse(bytes) {
    if (!bytes.length || bytes.length > 100 * 1024 * 1024)
      throw new CommercialPdfError("PDF_SIZE_LIMIT");
    // Explicit imports let serverless tracing include the Node fake-worker asset.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: true,
    });
    try {
      const document = await task.promise;
      if (document.numPages > COMMERCIAL_PDF_MAX_PAGES)
        throw new CommercialPdfError("PDF_PAGE_LIMIT");
      const pages: CommercialPdfPage[] = [];
      let totalText = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const spans = content.items.flatMap((item, index) =>
          "str" in item
            ? [
                {
                  index,
                  text: item.str,
                  transform: item.transform,
                  width: item.width,
                  height: item.height,
                  direction: item.dir,
                  hasEndOfLine: item.hasEOL,
                },
              ]
            : [],
        );
        const text = spans
          .map((span) => span.text + (span.hasEndOfLine ? "\n" : " "))
          .join("")
          .trim();
        totalText += text.length;
        if (
          text.length > 200_000 ||
          totalText > 3_000_000 ||
          spans.length > 20_000
        )
          throw new CommercialPdfError("PDF_TEXT_LIMIT");
        pages.push(
          commercialPdfPageSchema.parse({
            pageNumber,
            width: page.view[2]! - page.view[0]!,
            height: page.view[3]! - page.view[1]!,
            rotation: page.rotate,
            text,
            spans,
            warnings: text ? [] : ["NO_EXTRACTABLE_TEXT"],
          }),
        );
        page.cleanup();
      }
      return pages;
    } catch (error) {
      if (error instanceof CommercialPdfError) throw error;
      throw new CommercialPdfError(
        error instanceof Error && error.name === "PasswordException"
          ? "PDF_PASSWORD_REQUIRED"
          : "PDF_INVALID",
      );
    } finally {
      await task.destroy();
    }
  },
};
