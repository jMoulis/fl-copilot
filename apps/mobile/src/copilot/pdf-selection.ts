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
