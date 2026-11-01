import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { chatImportFixture } from "../../../../scripts/test-chat-import-fixtures";
import { MercalysImportCard } from "./mercalys-import-card";

vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("../components/ui", () => ({
  SecondaryButton: ({ label, onPress }: { label: string; onPress(): void }) =>
    createElement("Button", { accessibilityLabel: label, onPress }),
}));

it.each([false, true])(
  "keeps historical Mercalys messages read-only across mounts and opens only the ordinary importer when authorized (%s)",
  async (canOpen) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const s = await chatImportFixture();
    const onOpen = vi.fn();
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
          canOpen,
          onOpen,
        });
      await act(async () => {
        tree = create(render());
      });
      await act(async () => {
        tree!.update(render());
      });
      const buttons = tree!.root.findAllByProps({
        accessibilityLabel: "Ouvrir les imports Mercalys",
      });
      expect(buttons).toHaveLength(canOpen ? 1 : 0);
      expect(onOpen).not.toHaveBeenCalled();
      if (canOpen) {
        await act(async () => {
          buttons[0]!.props.onPress();
        });
        expect(onOpen).toHaveBeenCalledOnce();
      }
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
  },
);
