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
