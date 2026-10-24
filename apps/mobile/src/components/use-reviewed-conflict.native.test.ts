import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { useReviewedConflict } from "./use-reviewed-conflict";
vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
}));
it("never renders another committed context's review while its own read is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = console.error,
    spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        if (!String(args[0]).includes("react-test-renderer is deprecated"))
          original(...args);
      });
  const frames: { owner: string; shown: string | undefined }[] = [];
  let resolve!: (r: { owner: string }) => void;
  const pending = new Promise<{ owner: string }>((r) => {
      resolve = r;
    }),
    a = {},
    b = {},
    readA = async () => ({ owner: "A" }),
    readB = () => pending;
  function Witness({
    owner,
    scope,
    read,
  }: {
    owner: string;
    scope: object;
    read: () => Promise<{ owner: string }>;
  }) {
    const s = useReviewedConflict({
      scope,
      read,
      canChoose: () => false,
      choose: async () => {},
      errorText: () => "Erreur",
      onSuccess: () => {},
    });
    frames.push({ owner, shown: s.review?.owner });
    return createElement("Review", { shown: s.review?.owner });
  }
  let tree: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = create(
        createElement(Witness, { owner: "A", scope: a, read: readA }),
      );
    });
    expect(frames.some((f) => f.shown === "A")).toBe(true);
    frames.length = 0;
    await act(async () => {
      tree!.update(
        createElement(Witness, { owner: "B", scope: b, read: readB }),
      );
    });
    expect(
      frames.filter((f) => f.owner === "B").every((f) => f.shown === undefined),
    ).toBe(true);
    await act(async () => {
      resolve({ owner: "B" });
    });
    expect(frames.at(-1)).toEqual({ owner: "B", shown: "B" });
  } finally {
    if (tree) await act(async () => tree!.unmount());
    spy.mockRestore();
  }
});
