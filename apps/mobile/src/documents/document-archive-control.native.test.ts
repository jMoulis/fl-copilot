import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { documentArchiveFixture } from "../../../../scripts/test-document-archive-fixtures";
import { DocumentArchiveControl } from "./document-archive-control";
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
}));
vi.mock("expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
vi.mock("../components/ui", () => ({
  SecondaryButton: (props: object) => createElement("Button", props),
  InlineAlert: (props: object) => createElement("Alert", props),
}));
let tree: ReactTestRenderer | undefined;
const fixtures: Awaited<ReturnType<typeof documentArchiveFixture>>[] = [];
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  for (const s of fixtures.splice(0)) s.db.close();
});
const button = () =>
  tree!.root.findAll((node) => String(node.type) === "Button")[0]!;
async function fixture() {
  const s = await documentArchiveFixture();
  fixtures.push(s);
  return s;
}
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

it("archives/restores on explicit press, keeps source data and ignores double taps", async () => {
  const s = await fixture(),
    changed = vi.fn(async () => {});
  const props = {
    repository: s.archives,
    access: { deviceId: s.scope.deviceId, canWrite: () => true },
    id: s.document.id,
    targetKind: "COMMERCIAL_DOCUMENT" as const,
    archived: false,
    name: "Test.pdf",
    onChanged: changed,
  };
  await act(async () => {
    tree = create(createElement(DocumentArchiveControl, props));
  });
  expect(await s.archives.list()).toEqual([]);
  await act(async () => {
    button().props.onPress();
    button().props.onPress();
    await flush();
  });
  expect(await s.archives.list()).toMatchObject([{ archived: true }]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect((await s.sources.getDocument(s.document.id))?.deletedAt).toBeNull();
  await act(async () =>
    tree!.update(
      createElement(DocumentArchiveControl, { ...props, archived: true }),
    ),
  );
  expect(button().props.label).toBe("Restaurer");
  await act(async () => {
    button().props.onPress();
    await flush();
  });
  expect(await s.archives.list()).toMatchObject([{ archived: false }]);
});

it.each(["TARGET", "OWNER", "ARCHIVED"] as const)(
  "refuses a retained old press callback after a %s change",
  async (mode) => {
    const s = await fixture();
    const props = {
      repository: s.archives,
      access: { deviceId: s.scope.deviceId, canWrite: () => true },
      id: s.document.id,
      targetKind: "COMMERCIAL_DOCUMENT" as const,
      archived: false,
      name: "Test.pdf",
      onChanged: async () => {},
    };
    await act(async () => {
      tree = create(createElement(DocumentArchiveControl, props));
    });
    const old = button().props.onPress;
    const other = mode === "OWNER" ? await fixture() : undefined;
    await act(async () =>
      tree!.update(
        createElement(DocumentArchiveControl, {
          ...props,
          ...(mode === "TARGET"
            ? { id: randomUUID() }
            : mode === "OWNER"
              ? { repository: other!.archives }
              : { archived: true }),
        }),
      ),
    );
    await act(async () => {
      old();
      await flush();
    });
    expect(await s.archives.list()).toEqual([]);
    if (other) expect(await other.archives.list()).toEqual([]);
  },
);

it.each(["BLUR", "UNMOUNT"] as const)(
  "cancels an archive waiting on the SQLite writer when the screen closes (%s)",
  async (mode) => {
    const s = await fixture();
    let allowed = true,
      release!: () => void,
      entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      waiting = new Promise<void>((r) => (entered = r));
    const transaction = s.a.withExclusiveTransactionAsync.bind(s.a);
    vi.spyOn(s.a, "withExclusiveTransactionAsync").mockImplementationOnce(
      async (task) => {
        entered();
        await gate;
        await transaction(task);
      },
    );
    await act(async () => {
      tree = create(
        createElement(DocumentArchiveControl, {
          repository: s.archives,
          access: { deviceId: s.scope.deviceId, canWrite: () => allowed },
          id: s.document.id,
          targetKind: "COMMERCIAL_DOCUMENT",
          archived: false,
          name: "Test.pdf",
          onChanged: async () => {},
        }),
      );
    });
    await act(async () => {
      button().props.onPress();
      await waiting;
    });
    await act(async () => {
      if (mode === "BLUR") allowed = false;
      else {
        tree!.unmount();
        tree = undefined;
      }
    });
    await act(async () => {
      release();
      await flush();
    });
    expect(await s.archives.list()).toEqual([]);
  },
);

it("reports a list-refresh failure as already saved and performs no reads on 100 ordinary rerenders", async () => {
  const s = await fixture(),
    read = vi.spyOn(s.archives, "list");
  const props = {
    repository: s.archives,
    access: { deviceId: s.scope.deviceId, canWrite: () => true },
    id: s.document.id,
    targetKind: "COMMERCIAL_DOCUMENT" as const,
    archived: false,
    name: "Test.pdf",
    onChanged: async () => {
      throw Error("READ_FAILED");
    },
  };
  await act(async () => {
    tree = create(createElement(DocumentArchiveControl, props));
    for (let i = 0; i < 100; i++)
      tree.update(createElement(DocumentArchiveControl, { ...props }));
  });
  expect(read).not.toHaveBeenCalled();
  await act(async () => {
    button().props.onPress();
    await flush();
  });
  expect(
    tree!.root.findAll((node) => String(node.type) === "Alert")[0]!.props
      .message,
  ).toContain("est enregistré");
  expect(await s.archives.list()).toMatchObject([{ archived: true }]);
});
