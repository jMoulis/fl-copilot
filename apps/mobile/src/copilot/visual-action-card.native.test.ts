import { randomUUID } from "node:crypto";
import { createElement, useEffect, type ReactNode } from "react";
import { Image } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import {
  visualActionFixture,
  visualActionDigest,
} from "../../../../scripts/test-visual-action-fixtures";
import { CopilotVisualActionController } from "./visual-action-controller";
import { VisualActionCard } from "./visual-action-card";
const runtime = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Switch: "Switch",
  Image: "Image",
  ActivityIndicator: "Spinner",
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (fn: () => void | (() => void)) => useEffect(fn, [fn]),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => runtime.database,
}));
vi.mock("../products/visual-file-storage", () => ({
  nativeVisualFileStorage: {
    uri: vi.fn(async () => "file:///fixture-reviewed.jpg"),
  },
}));
vi.mock("../components/ui", () => ({
  SectionCard: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("View", {}, createElement("Text", {}, title), children),
  SecondaryButton: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
  }) =>
    createElement(
      "Pressable",
      { onPress, disabled, accessibilityLabel: label },
      label,
    ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () =>
  act(async () => {
    await new Promise<void>((r) => setImmediate(r));
  });
const button = (r: ReactTestRenderer) =>
  r.root.findByProps({ accessibilityLabel: "Confirmer le choix d’image" });
async function ready(r: ReactTestRenderer) {
  await vi.waitFor(async () => {
    await flush();
    expect(
      r.root.findAllByProps({
        accessibilityLabel: "Confirmer le choix d’image",
      }),
      JSON.stringify(r.toJSON()),
    ).toHaveLength(1);
  });
}
async function compare(r: ReactTestRenderer) {
  await act(async () =>
    r.root
      .findByProps({
        accessibilityLabel: "J’ai vérifié l’image et je confirme ce choix",
      })
      .props.onValueChange(true),
  );
}
async function viewPhoto(r: ReactTestRenderer) {
  await act(async () =>
    r.root
      .findByProps({
        accessibilityLabel: "Voir la photo conservée sur cet appareil",
      })
      .props.onPress(),
  );
  await vi.waitFor(async () => {
    await flush();
    expect(r.root.findAllByType(Image)).toHaveLength(1);
  });
}
it.each(["ASSIGN_LIBRARY", "REMOVE_PRODUCT", "REVOKE_CURRENT"] as const)(
  "mounts and confirms %s with separate photo/global review and canonical local results",
  async (action) => {
    const s = await visualActionFixture(action);
    runtime.database = { sqlite: s.db };
    let r: ReactTestRenderer | undefined;
    const onSaved = vi.fn(),
      requestPreview = vi.fn();
    try {
      await act(async () => {
        r = create(
          createElement(VisualActionCard, {
            message: s.message,
            controller: s.controller,
            canConfirm: true,
            onSaved,
            requestPreview,
          }),
        );
      });
      await ready(r!);
      await compare(r!);
      if (action === "ASSIGN_LIBRARY") {
        expect(button(r!).props.disabled).toBe(true);
        await viewPhoto(r!);
        expect(button(r!).props.disabled).toBe(true);
        await act(async () => r!.root.findByType(Image).props.onLoad());
      }
      if (action === "REVOKE_CURRENT") {
        expect(button(r!).props.disabled).toBe(true);
        await act(async () =>
          r!.root
            .findByProps({
              accessibilityLabel:
                "Je confirme le retrait de cette image pour tous les produits",
            })
            .props.onValueChange(true),
        );
      }
      expect(button(r!).props.disabled).toBe(false);
      await act(async () => button(r!).props.onPress());
      await vi.waitFor(async () => {
        await flush();
        expect(onSaved).toHaveBeenCalledTimes(1);
      });
      expect((await s.controller.open(s.message)).status).toBe("COMPLETED");
      expect(JSON.stringify(r!.toJSON())).toContain(
        "Choix enregistré sur cet appareil",
      );
      expect(requestPreview).not.toHaveBeenCalled();
    } finally {
      if (r) await act(async () => r!.unmount());
      s.db.raw.close();
    }
  },
);
it("rejects a retained confirmation after permission loss and requires fresh consent after rights return", async () => {
  const s = await visualActionFixture("REMOVE_PRODUCT");
  runtime.database = { sqlite: s.db };
  let r: ReactTestRenderer | undefined;
  const onSaved = vi.fn(),
    requestPreview = vi.fn();
  try {
    await act(async () => {
      r = create(
        createElement(VisualActionCard, {
          message: s.message,
          controller: s.controller,
          canConfirm: true,
          onSaved,
          requestPreview,
        }),
      );
    });
    await ready(r!);
    await compare(r!);
    const retained = button(r!).props.onPress;
    const revoked = new CopilotVisualActionController(
        s.db,
        { ...s.scope, canManageVisualLibrary: false },
        visualActionDigest,
        randomUUID,
      ),
      before = s.db.raw
        .prepare("SELECT * FROM sync_outbox ORDER BY rowid")
        .all();
    await act(async () =>
      r!.update(
        createElement(VisualActionCard, {
          message: s.message,
          controller: revoked,
          canConfirm: false,
          onSaved,
          requestPreview,
        }),
      ),
    );
    await act(async () => retained());
    expect(
      s.db.raw.prepare("SELECT * FROM sync_outbox ORDER BY rowid").all(),
    ).toEqual(before);
    await act(async () =>
      r!.update(
        createElement(VisualActionCard, {
          message: s.message,
          controller: s.controller,
          canConfirm: true,
          onSaved,
          requestPreview,
        }),
      ),
    );
    await ready(r!);
    expect(button(r!).props.disabled).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  } finally {
    if (r) await act(async () => r!.unmount());
    s.db.raw.close();
  }
});

it("requires a separate restoration decision for a previously removed association", async () => {
  const s = await visualActionFixture("ASSIGN_LIBRARY", ":memory:", {
    retiredAssociation: true,
  });
  runtime.database = { sqlite: s.db };
  let r: ReactTestRenderer | undefined;
  const onSaved = vi.fn(),
    requestPreview = vi.fn();
  try {
    await act(async () => {
      r = create(
        createElement(VisualActionCard, {
          message: s.message,
          controller: s.controller,
          canConfirm: true,
          onSaved,
          requestPreview,
        }),
      );
    });
    await ready(r!);
    await compare(r!);
    await viewPhoto(r!);
    await act(async () => r!.root.findByType(Image).props.onLoad());
    expect(button(r!).props.disabled).toBe(true);
    await act(async () =>
      r!.root
        .findByProps({
          accessibilityLabel:
            "Je confirme le rétablissement de l’association à une image",
        })
        .props.onValueChange(true),
    );
    expect(button(r!).props.disabled).toBe(false);
    await act(async () => button(r!).props.onPress());
    await vi.waitFor(async () => {
      await flush();
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(
      (await s.library.get("product_visual_link", s.f.storeId, s.f.link.id))!
        .entity.deletedAt,
    ).toBeNull();
  } finally {
    if (r) await act(async () => r!.unmount());
    s.db.raw.close();
  }
});
it("does not accept a failed native image decode as a viewed photo", async () => {
  const s = await visualActionFixture();
  runtime.database = { sqlite: s.db };
  let r: ReactTestRenderer | undefined;
  const onSaved = vi.fn(),
    requestPreview = vi.fn();
  try {
    await act(async () => {
      r = create(
        createElement(VisualActionCard, {
          message: s.message,
          controller: s.controller,
          canConfirm: true,
          onSaved,
          requestPreview,
        }),
      );
    });
    await ready(r!);
    await compare(r!);
    await viewPhoto(r!);
    await act(async () => r!.root.findByType(Image).props.onLoad());
    expect(button(r!).props.disabled).toBe(false);
    await act(async () => r!.root.findByType(Image).props.onError());
    expect(button(r!).props.disabled).toBe(true);
    expect(r!.root.findAllByType(Image)).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
  } finally {
    if (r) await act(async () => r!.unmount());
    s.db.raw.close();
  }
});
it.each([false, true])(
  "requires the actual attached photo and independent usage rights (retired=%s)",
  async (retired) => {
    const s = await visualActionFixture("ASSIGN_SOURCE", ":memory:", {
      retiredAssociation: retired,
    });
    runtime.database = { sqlite: s.db };
    let r: ReactTestRenderer | undefined;
    const onSaved = vi.fn();
    try {
      await act(async () => {
        r = create(
          createElement(VisualActionCard, {
            message: s.message,
            controller: s.controller,
            canConfirm: true,
            onSaved,
            requestPreview: vi.fn(),
          }),
        );
      });
      await ready(r!);
      await compare(r!);
      expect(button(r!).props.disabled).toBe(true);
      expect(r!.root.findAllByType(Image)).toHaveLength(0);
      await act(async () =>
        r!.root
          .findByProps({ accessibilityLabel: "Préparer la photo jointe" })
          .props.onPress(),
      );
      await vi.waitFor(async () => {
        await flush();
        expect(r!.root.findAllByType(Image)).toHaveLength(1);
      });
      await act(async () => r!.root.findByType(Image).props.onLoad());
      expect(button(r!).props.disabled).toBe(true);
      await act(async () =>
        r!.root
          .findByProps({
            accessibilityLabel:
              "Je confirme les droits d’utilisation de cette photo",
          })
          .props.onValueChange(true),
      );
      if (retired) {
        expect(button(r!).props.disabled).toBe(true);
        await act(async () =>
          r!.root
            .findByProps({
              accessibilityLabel:
                "Je confirme le rétablissement de l’association à une image",
            })
            .props.onValueChange(true),
        );
      }
      expect(button(r!).props.disabled).toBe(false);
      await act(async () => button(r!).props.onPress());
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(
        (await s.controller.open(s.message)).result?.sourceDocumentId,
      ).toBe(s.sourcePhoto.sourceDocumentId);
    } finally {
      if (r) await act(async () => r!.unmount());
      s.db.raw.close();
    }
  },
);
it("ignores a retained image-load callback after rereading the source proposal", async () => {
  const s = await visualActionFixture("ASSIGN_SOURCE");
  runtime.database = { sqlite: s.db };
  let r: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      r = create(
        createElement(VisualActionCard, {
          message: s.message,
          controller: s.controller,
          canConfirm: true,
          onSaved: vi.fn(),
          requestPreview: vi.fn(),
        }),
      );
    });
    await ready(r!);
    await act(async () =>
      r!.root
        .findByProps({ accessibilityLabel: "Préparer la photo jointe" })
        .props.onPress(),
    );
    await vi.waitFor(async () => {
      await flush();
      expect(r!.root.findAllByType(Image)).toHaveLength(1);
    });
    const staleLoad = r!.root.findByType(Image).props.onLoad;
    const readButton = r!.root.findByProps({
      accessibilityLabel: "Relire les informations",
    });
    expect(readButton).toBeDefined();
    await act(async () => readButton!.props.onPress());
    await ready(r!);
    await compare(r!);
    await act(async () =>
      r!.root
        .findByProps({
          accessibilityLabel:
            "Je confirme les droits d’utilisation de cette photo",
        })
        .props.onValueChange(true),
    );
    await act(async () => staleLoad());
    expect(button(r!).props.disabled).toBe(true);
  } finally {
    if (r) await act(async () => r!.unmount());
    s.db.raw.close();
  }
});
