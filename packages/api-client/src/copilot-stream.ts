import {
  copilotActivitySchema,
  type CopilotActivity,
} from "@fl-copilot/sync-contracts";
/** Decode bounded newline-delimited snapshots; only a final validated result is durable. */
export async function readCopilotStream(
  response: Response,
  expected: { replyId: string; conversationId: string },
  onProgress: (text: string) => void,
  signal?: AbortSignal,
  onActivity?: (activity: CopilotActivity) => void,
): Promise<unknown> {
  if (!response.body) throw Error("COPILOT_STREAM_UNAVAILABLE");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    total = 0,
    result: unknown,
    doneResult = false;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw Error("COPILOT_STREAM_CANCELLED");
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch (error) {
        // A native connection can fail while closing after the final NDJSON frame.
        // The API client still validates this result and its complete reply scope.
        if (
          !signal?.aborted &&
          doneResult &&
          !(buffer + decoder.decode()).trim()
        )
          return result;
        throw error;
      }
      if (signal?.aborted) throw Error("COPILOT_STREAM_CANCELLED");
      total += next.value?.byteLength ?? 0;
      if (total > 4 * 1024 * 1024) throw Error("COPILOT_STREAM_LIMIT");
      buffer += decoder.decode(next.value, { stream: !next.done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        if (end > 1024 * 1024) throw Error("COPILOT_STREAM_LIMIT");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== "object")
          throw Error("COPILOT_STREAM_INVALID");
        const item = event as Record<string, unknown>;
        if (doneResult) throw Error("COPILOT_STREAM_INVALID");
        if (item.type === "activity") {
          if (
            item.replyId !== expected.replyId ||
            item.conversationId !== expected.conversationId
          )
            throw Error("COPILOT_STREAM_SCOPE_INVALID");
          onActivity?.(copilotActivitySchema.parse(item.activity));
        } else if (item.type === "text") {
          if (
            item.replyId !== expected.replyId ||
            item.conversationId !== expected.conversationId ||
            typeof item.text !== "string" ||
            item.text.length > 16000
          )
            throw Error("COPILOT_STREAM_SCOPE_INVALID");
          onProgress(item.text);
        } else if (item.type === "result") {
          result = item.result;
          doneResult = true;
        } else throw Error("COPILOT_STREAM_FAILED");
      }
      if (buffer.length > 1024 * 1024) throw Error("COPILOT_STREAM_LIMIT");
      if (next.done) break;
    }
    if (!doneResult || buffer.trim()) throw Error("COPILOT_STREAM_INCOMPLETE");
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
