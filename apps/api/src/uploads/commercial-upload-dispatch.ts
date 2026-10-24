type Dispatch = (storeId: string, sourceDocumentId: string) => Promise<void>;
type Failure = {
  code:
    "COMMERCIAL_UPLOAD_DISPATCH_FAILED" | "COMMERCIAL_UPLOAD_LIFECYCLE_FAILED";
  storeId: string;
  sourceDocumentId: string;
};

/** Called only after the original and its processing intent have been persisted. */
export function createCommercialUploadDispatch(
  dispatch: Dispatch,
  waitUntil: ((task: Promise<void>) => void) | undefined,
  report: (failure: Failure) => void,
): Dispatch {
  return async (storeId, sourceDocumentId) => {
    const reportSafely = (code: Failure["code"]) => {
      try {
        // Provider exceptions can contain signed URLs or secrets. Never forward them.
        report({ code, storeId, sourceDocumentId });
      } catch {
        // A logging failure must not invalidate an already confirmed upload.
      }
    };
    const task = Promise.resolve()
      .then(() => dispatch(storeId, sourceDocumentId))
      .catch(() => reportSafely("COMMERCIAL_UPLOAD_DISPATCH_FAILED"));
    if (waitUntil) {
      try {
        waitUntil(task);
        return;
      } catch {
        reportSafely("COMMERCIAL_UPLOAD_LIFECYCLE_FAILED");
      }
    }
    // Portable Node runtime, or rejected lifecycle registration: drain the same task.
    // Failed delivery remains recoverable from the existing durable PENDING job.
    await task;
  };
}
