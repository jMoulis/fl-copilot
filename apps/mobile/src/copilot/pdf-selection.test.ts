import { expect, it, vi } from "vitest";
import { selectCopilotPdf } from "./pdf-selection";
it("retains a selected PDF once and returns its stable source identity", async () => {
  const pick = vi.fn(async () => ({ name: "Brief.pdf" })),
    retain = vi.fn(async () => "stable-source");
  expect(
    await selectCopilotPdf({ pick, retain }, new AbortController().signal),
  ).toBe("stable-source");
  expect(retain).toHaveBeenCalledExactlyOnceWith({ name: "Brief.pdf" });
});
it("a dismissed picker leaves the draft/source untouched", async () => {
  const retain = vi.fn();
  expect(
    await selectCopilotPdf(
      { pick: async () => undefined, retain },
      new AbortController().signal,
    ),
  ).toBeUndefined();
  expect(retain).not.toHaveBeenCalled();
});
it.each(["before", "during"] as const)(
  "does not retain a file after scope cancellation %s selection",
  async (phase) => {
    const controller = new AbortController(),
      retain = vi.fn();
    if (phase === "before") controller.abort();
    const pick = vi.fn(async () => {
      controller.abort();
      return { name: "Brief.pdf" };
    });
    await expect(
      selectCopilotPdf({ pick, retain }, controller.signal),
    ).rejects.toThrow("COPILOT_ATTACHMENT_CANCELLED");
    expect(retain).not.toHaveBeenCalled();
    expect(pick).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
  },
);
it("an already retained source survives cancellation and is never bound to another topic", async () => {
  const controller = new AbortController();
  const retain = vi.fn(async () => {
    controller.abort();
    return "retained-source";
  });
  await expect(
    selectCopilotPdf(
      { pick: async () => ({ name: "Brief.pdf" }), retain },
      controller.signal,
    ),
  ).rejects.toThrow("COPILOT_ATTACHMENT_CANCELLED");
  expect(retain).toHaveBeenCalledTimes(1);
});

it("keeps successful PDFs when another file fails, without duplicating retained identities", async () => {
  const { selectCopilotPdfs } = await import("./pdf-selection");
  const retained: string[] = [];
  const result = await selectCopilotPdfs(
    {
      pick: async () => [
        { name: "A.pdf" },
        { name: "Invalid.pdf" },
        { name: "Duplicate.pdf" },
      ],
      retain: async (asset) => {
        retained.push(asset.name);
        if (asset.name === "Invalid.pdf") throw Error("COMMERCIAL_PDF_INVALID");
        return "owned-original";
      },
    },
    new AbortController().signal,
    3,
  );
  expect(result).toEqual({
    sourceIds: ["owned-original"],
    failures: [{ filename: "Invalid.pdf", code: "COMMERCIAL_PDF_INVALID" }],
  });
  expect(retained).toEqual(["A.pdf", "Invalid.pdf", "Duplicate.pdf"]);
});
it("refuses an oversized selection before retaining any file and never truncates it", async () => {
  const { selectCopilotPdfs } = await import("./pdf-selection");
  const retain = vi.fn();
  await expect(
    selectCopilotPdfs(
      { pick: async () => [{ name: "A.pdf" }, { name: "B.pdf" }], retain },
      new AbortController().signal,
      1,
    ),
  ).rejects.toThrow("COPILOT_ATTACHMENT_LIMIT");
  expect(retain).not.toHaveBeenCalled();
});
it("stops a PDF batch after cancellation without treating it as a per-file failure or retaining later files", async () => {
  const { selectCopilotPdfs } = await import("./pdf-selection");
  const abort = new AbortController();
  const retain = vi.fn(async () => {
    abort.abort();
    return "already-retained";
  });
  await expect(
    selectCopilotPdfs(
      { pick: async () => [{ name: "A.pdf" }, { name: "B.pdf" }], retain },
      abort.signal,
      2,
    ),
  ).rejects.toThrow("COPILOT_ATTACHMENT_CANCELLED");
  expect(retain).toHaveBeenCalledTimes(1);
});
