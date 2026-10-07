// PDF.js exposes its worker as JavaScript without a declaration for this path.
// Only its module initialization is used, to make the worker asset traceable.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
