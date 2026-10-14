/** Native selection may outlive a topic/session; a retained source must never bind to a new scope. */
export async function selectCopilotPdf<Asset>(
  dependencies: {
    pick(): Promise<Asset | undefined>;
    retain(asset: Asset): Promise<string>;
  },
  signal: AbortSignal,
) {
  const cancelled = () => {
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
  };
  cancelled();
  const asset = await dependencies.pick();
  cancelled();
  if (!asset) return undefined;
  const sourceId = await dependencies.retain(asset);
  // Once retained, preserve the original even if navigation/sign-out interrupted this attempt.
  cancelled();
  return sourceId;
}

export type CopilotPdfSelection = {
  sourceIds: string[];
  failures: Array<{ filename: string; code: string }>;
};
/** Small composer batches only. Validate the whole selection before retaining any original. */
export async function selectCopilotPdfs<Asset extends { name: string }>(
  dependencies: {
    pick(): Promise<Asset[] | undefined>;
    retain(asset: Asset): Promise<string>;
  },
  signal: AbortSignal,
  capacity: number,
): Promise<CopilotPdfSelection | undefined> {
  const cancelled = () => {
    if (signal.aborted) throw Error("COPILOT_ATTACHMENT_CANCELLED");
  };
  cancelled();
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10)
    throw Error("COPILOT_ATTACHMENT_LIMIT");
  const assets = await dependencies.pick();
  cancelled();
  if (!assets?.length) return undefined;
  if (assets.length > capacity) throw Error("COPILOT_ATTACHMENT_LIMIT");
  const result: CopilotPdfSelection = { sourceIds: [], failures: [] };
  for (const asset of assets) {
    cancelled();
    try {
      const id = await dependencies.retain(asset);
      cancelled();
      if (!result.sourceIds.includes(id)) result.sourceIds.push(id);
    } catch (reason) {
      cancelled();
      result.failures.push({
        filename: asset.name,
        code:
          reason instanceof Error
            ? reason.message
            : "COPILOT_ATTACHMENT_FAILED",
      });
    }
  }
  return result;
}
