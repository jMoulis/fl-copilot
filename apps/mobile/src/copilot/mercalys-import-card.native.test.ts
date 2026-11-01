import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { chatImportFixture } from "../../../../scripts/test-chat-import-fixtures";
import { MercalysImportCard } from "./mercalys-import-card";

vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
it("keeps historical Mercalys messages passive and their files available in the Actions importer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const s = await chatImportFixture();
  let tree: ReactTestRenderer | undefined;
  try {
    const file = await s.add();
    const before = s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get();
    const messages = s.db
      .prepare("SELECT COUNT(*) n FROM copilot_messages")
      .get();
    const render = () =>
      createElement(MercalysImportCard, {
        message: file.message,
      });
    await act(async () => {
      tree = create(render());
    });
    await act(async () => {
      tree!.update(render());
    });
    expect(
      tree!.root.findAll((node) => typeof node.props.onPress === "function"),
    ).toHaveLength(0);
    expect(JSON.stringify(tree!.toJSON())).toContain("Actions →");
    const { MercalysBatchRepository } =
      await import("../documents/mercalys-batch-repository");
    const imports = new MercalysBatchRepository(s.a, {
      storeId: s.scope.storeId,
      ownerId: s.scope.ownerId,
    });
    expect((await imports.recent()).batches.map((b) => b.id)).toContain(
      file.batch.id,
    );
    expect(s.db.prepare("SELECT COUNT(*) n FROM sync_outbox").get()).toEqual(
      before,
    );
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM copilot_messages").get(),
    ).toEqual(messages);
    expect(
      s.db.prepare("SELECT COUNT(*) n FROM sales_observations").get(),
    ).toMatchObject({ n: 0 });
    expect(s.calls()).toBe(0);
  } finally {
    if (tree)
      await act(async () => {
        tree!.unmount();
      });
    s.db.close();
  }
});
