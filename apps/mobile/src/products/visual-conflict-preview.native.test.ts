import { createElement, useEffect, type ReactNode } from "react";
import { Image, Pressable } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { nativeVisualConflictFixture } from "../../../../scripts/test-visual-conflict-fixtures";
import { VisualVersion } from "./visual-conflict-preview";
const runtime = vi.hoisted(() => ({
  database: undefined as unknown,
  focus: undefined as undefined | (() => void),
  blur: undefined as undefined | (() => void),
  uri: vi.fn<(...args: unknown[]) => Promise<string | null>>(),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  Image: "Image",
  Pressable: "Pressable",
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (fn: () => void | (() => void)) =>
    useEffect(() => {
      let cleanup: void | (() => void);
      runtime.focus = () => {
        cleanup = fn();
      };
      runtime.blur = () => {
        cleanup?.();
        cleanup = undefined;
      };
      runtime.focus();
      return () => runtime.blur?.();
    }, [fn]),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("./visual-file-storage", () => ({
  nativeVisualFileStorage: { uri: runtime.uri },
}));
vi.mock("../components/ui", () => ({
  SectionCard: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("View", {}, createElement("Text", {}, title), children),
  SecondaryButton: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled: boolean;
    onPress: () => void;
  }) =>
    createElement("Pressable", {
      accessibilityLabel: label,
      disabled,
      onPress,
    }),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  runtime.uri.mockReset();
});
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
const openButton = (r: ReactTestRenderer) => r.root.findByType(Pressable);
async function fixtures() {
  const a = await nativeVisualConflictFixture("visual_asset"),
    b = await nativeVisualConflictFixture("visual_asset");
  const snapshot = (s: typeof a) =>
    [
      "products",
      "visual_assets",
      "visual_identities",
      "product_visual_links",
      "visual_asset_files",
      "sync_outbox",
      "sync_conflicts",
      "visual_conflict_history",
    ].map((table) =>
      s.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
  const beforeA = snapshot(a),
    beforeB = snapshot(b);
  const view = (s: typeof a) =>
    createElement(VisualVersion, {
      title: s.scope.storeId,
      entity: s.review.local,
      labels: {},
      preview: s.f.asset,
    });
  runtime.database = { sqlite: a.a };
  let r: ReactTestRenderer;
  await act(async () => {
    r = create(view(a));
  });
  return {
    a,
    b,
    r: r!,
    async change(sameDatabase = false) {
      runtime.database = { sqlite: sameDatabase ? a.a : b.a };
      await act(async () => r.update(view(b)));
    },
    async close() {
      await act(async () => r.unmount());
      expect(snapshot(a)).toEqual(beforeA);
      expect(snapshot(b)).toEqual(beforeB);
      a.db.close();
      b.db.close();
    },
  };
}
it.each([true, false])(
  "clears a displayed local photo when the source changes (same database=%s)",
  async (sameDatabase) => {
    const s = await fixtures();
    try {
      runtime.uri.mockResolvedValue("file:///fixture-a.jpg");
      await act(async () => openButton(s.r).props.onPress());
      await vi.waitFor(async () => {
        await flush();
        expect(s.r.root.findByType(Image).props.source.uri).toBe(
          "file:///fixture-a.jpg",
        );
      });
      await s.change(sameDatabase);
      expect(s.r.root.findAllByType(Image)).toHaveLength(0);
      expect(openButton(s.r).props.disabled).toBe(false);
    } finally {
      await s.close();
    }
  },
);
it("rejects a late prior-store file read and allows the newly selected photo to open", async () => {
  const s = await fixtures();
  let resolve!: (uri: string) => void;
  const old = new Promise<string>((r) => {
    resolve = r;
  });
  try {
    runtime.uri.mockImplementation((store) =>
      store === s.a.scope.storeId
        ? old
        : Promise.resolve("file:///fixture-b.jpg"),
    );
    await act(async () => openButton(s.r).props.onPress());
    await vi.waitFor(async () => {
      await flush();
      expect(runtime.uri).toHaveBeenCalledTimes(1);
    });
    await s.change();
    expect(openButton(s.r).props.disabled).toBe(false);
    await act(async () => openButton(s.r).props.onPress());
    await vi.waitFor(async () => {
      await flush();
      expect(s.r.root.findByType(Image).props.source.uri).toBe(
        "file:///fixture-b.jpg",
      );
    });
    await act(async () => resolve("file:///fixture-a.jpg"));
    await flush();
    expect(s.r.root.findByType(Image).props.source.uri).toBe(
      "file:///fixture-b.jpg",
    );
  } finally {
    resolve?.("file:///fixture-a.jpg");
    await s.close();
  }
});
it("does not run a retained old source callback after the committed selection changes", async () => {
  const s = await fixtures();
  try {
    runtime.uri.mockResolvedValue("file:///fixture-a.jpg");
    const retained = openButton(s.r).props.onPress as () => void;
    await s.change();
    await act(async () => retained());
    await flush();
    expect(runtime.uri).not.toHaveBeenCalled();
    expect(s.r.root.findAllByType(Image)).toHaveLength(0);
  } finally {
    await s.close();
  }
});

it("invalidates an in-flight read on blur, rejects old taps, and permits a fresh focus read", async () => {
  const s = await fixtures();
  let resolve!: (value: string) => void;
  try {
    const old = new Promise<string>((r) => {
      resolve = r;
    });
    runtime.uri
      .mockReturnValueOnce(old)
      .mockResolvedValue("file:///fixture-current.jpg");
    const retained = openButton(s.r).props.onPress as () => void;
    await act(async () => retained());
    await vi.waitFor(async () => {
      await flush();
      expect(runtime.uri).toHaveBeenCalledTimes(1);
    });
    await act(async () => runtime.blur?.());
    await act(async () => retained());
    expect(runtime.uri).toHaveBeenCalledTimes(1);
    await act(async () => runtime.focus?.());
    expect(openButton(s.r).props.disabled).toBe(false);
    await act(async () => openButton(s.r).props.onPress());
    await vi.waitFor(async () => {
      await flush();
      expect(s.r.root.findByType(Image).props.source.uri).toBe(
        "file:///fixture-current.jpg",
      );
    });
    await act(async () => resolve("file:///fixture-obsolete.jpg"));
    await flush();
    expect(s.r.root.findByType(Image).props.source.uri).toBe(
      "file:///fixture-current.jpg",
    );
  } finally {
    resolve?.("file:///fixture-obsolete.jpg");
    await s.close();
  }
});
it("coalesces two retained taps while the same local read is pending", async () => {
  const s = await fixtures();
  let resolve!: (value: string) => void;
  try {
    runtime.uri.mockReturnValue(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    const retained = openButton(s.r).props.onPress as () => void;
    await act(async () => {
      retained();
      retained();
    });
    await vi.waitFor(async () => {
      await flush();
      expect(runtime.uri).toHaveBeenCalledTimes(1);
    });
    await act(async () => resolve("file:///fixture-a.jpg"));
    await flush();
    expect(runtime.uri).toHaveBeenCalledTimes(1);
  } finally {
    resolve?.("file:///fixture-a.jpg");
    await s.close();
  }
});

it("does not continue an obsolete cache lookup into a file read", async () => {
  const s = await fixtures();
  let resolve!: () => void;
  try {
    const wait = new Promise<void>((r) => {
        resolve = r;
      }),
      read = vi
        .spyOn(s.a.a, "getFirstAsync")
        .mockImplementationOnce(async () => {
          await wait;
          return null;
        });
    runtime.uri.mockResolvedValue("file:///fixture-a.jpg");
    await act(async () => openButton(s.r).props.onPress());
    expect(read).toHaveBeenCalledTimes(1);
    await s.change();
    await act(async () => resolve());
    await flush();
    expect(runtime.uri).not.toHaveBeenCalled();
    expect(s.r.root.findAllByType(Image)).toHaveLength(0);
  } finally {
    resolve?.();
    await s.close();
  }
});
it("invalidates an old callback when only the database changes", async () => {
  const s = await fixtures();
  try {
    const retained = openButton(s.r).props.onPress as () => void;
    runtime.uri.mockResolvedValue("file:///fixture-a.jpg");
    runtime.database = { sqlite: s.b.a };
    await act(async () =>
      s.r.update(
        createElement(VisualVersion, {
          title: s.a.scope.storeId,
          entity: s.a.review.local,
          labels: {},
          preview: s.a.f.asset,
        }),
      ),
    );
    await act(async () => retained());
    await flush();
    expect(runtime.uri).not.toHaveBeenCalled();
  } finally {
    await s.close();
  }
});
