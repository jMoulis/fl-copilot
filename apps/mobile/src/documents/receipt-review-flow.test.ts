import { createElement, useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { wastePublicationFixture } from "../../../../scripts/test-waste-publication-fixtures";
import type {
  LocalWasteReceiptDetail,
  LocalWasteLineDraft,
} from "./waste-receipt-repository";
import {
  WastePublicationValidationError,
  type WastePublicationIssue,
} from "./waste-publication-validation";
import ReceiptScreen from "../app/waste-receipt/[id]";

const runtime = vi.hoisted(() => ({
  detail: null as LocalWasteReceiptDetail | null,
  issues: [] as WastePublicationIssue[],
  dirty: vi.fn(),
  write: vi.fn(),
  select: vi.fn(),
  publish: vi.fn(),
  validate: vi.fn(),
  aliases: vi.fn(),
  push: vi.fn(),
  sqlite: {},
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "Input",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Platform: { OS: "ios" },
  Alert: { alert: vi.fn() },
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: runtime.push, back: vi.fn() }),
  useLocalSearchParams: () => ({ id: runtime.detail!.receipt.id }),
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      user: { id: "owner" },
      stores: [{ storeId: runtime.detail!.receipt.storeId }],
    },
  }),
}));
vi.mock("../components/use-unsaved-form", () => ({
  useUnsavedForm: runtime.dirty,
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite, deviceId: "device" }),
}));
vi.mock("../sync/sync-provider", () => ({
  useSync: () => ({ status: "offline", syncNow: vi.fn() }),
}));
vi.mock("../components/ui", () => ({
  AppScreen: ({ children }: { children: ReactNode }) => children,
  AppHeader: "Header",
  InlineAlert: "Alert",
  PrimaryButton: "Button",
  SecondaryButton: "Button",
  StatusBadge: "Badge",
  SectionCard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../components/date-selector", () => ({
  DateSelector: "DateSelector",
}));
vi.mock("./receipt-source-photos", () => ({ ReceiptSourcePhotos: "Photos" }));
vi.mock("../products/product-master-repository", () => ({
  ProductMasterRepository: class {
    listAliasesByStore = runtime.aliases;
  },
}));
vi.mock("./waste-receipt-repository", () => ({
  WasteReceiptRepository: class {
    async getReceiptDetail() {
      return runtime.detail;
    }
    updateLineValues = runtime.write;
    selectProductCandidate = runtime.select;
  },
}));
vi.mock("./waste-receipt-publication", () => ({
  WasteReceiptPublicationRepository: class {
    async inspect() {
      return { issues: runtime.issues, warnings: [] };
    }
    validate = runtime.validate;
    publish = runtime.publish;
  },
}));
vi.mock("../analytics/local-recomputation", () => ({
  LocalAnalyticsRecomputationScheduler: class {},
  SQLiteProductDateRecomputer: class {},
}));

let rendered: ReactTestRenderer | undefined;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++frameId, fn);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      original(...args);
  });
  const f = wastePublicationFixture();
  runtime.detail = {
    receipt: {
      ...f.receipt,
      processingStatus: "TO_VALIDATE",
      dirty: false,
      syncState: "SYNCED",
    },
    lines: Array.from({ length: 140 }, (_, index): LocalWasteLineDraft => ({
      line: {
        ...f.lines[0]!,
        id: `line-${index}`,
        sourceLineIndex: index,
        rawLabel: `PRODUIT ${index}`,
        validationStatus: "TO_REVIEW",
      },
      matchedProductLabel: "FIGUE VRAC",
      candidates: [],
      matchState: "REVIEW",
      arithmeticStatus: "CONSISTENT",
      arithmeticDifference: "0",
      arithmeticExpectedTotal: "3",
      arithmeticWarningCode: null,
    })),
    uploadJob: null,
    duplicateCandidate: null,
    localFileUri: null,
  };
  runtime.issues = [];
  runtime.dirty.mockReset();
  runtime.write.mockReset().mockResolvedValue(undefined);
  runtime.select.mockReset().mockResolvedValue(undefined);
  runtime.publish.mockReset();
  runtime.validate.mockReset().mockImplementation(async () => runtime.issues);
  runtime.aliases.mockReset().mockResolvedValue([]);
  runtime.push.mockReset();
});
afterEach(async () => {
  await act(async () => rendered?.unmount());
  rendered = undefined;
  frames.clear();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    rendered = create(createElement(ReceiptScreen));
  });
}
const buttons = () => rendered!.root.findAllByType("Button" as never);
const button = (label: string) =>
  buttons().find(
    (n) => n.props.label === label || n.props.accessibilityLabel === label,
  )!;
const inputs = (label: string) =>
  rendered!.root
    .findAllByType("Input" as never)
    .filter((n) => n.props.accessibilityLabel === label);
async function click(label: string) {
  await act(async () => button(label).props.onPress());
}

it("mounts no line editor for 140 lines needing review, and only one actual form while switching and folding", async () => {
  await mount();
  expect(inputs("Libellé")).toHaveLength(0);
  expect(runtime.aliases).not.toHaveBeenCalled();
  await click("Examiner PRODUIT 0");
  expect(inputs("Libellé")).toHaveLength(1);
  expect(inputs("Libellé")[0]!.props.value).toBe("PRODUIT 0");
  for (let i = 1; i <= 100; i++) await click(`Examiner PRODUIT ${i}`);
  expect(inputs("Libellé")).toHaveLength(1);
  expect(inputs("Libellé")[0]!.props.value).toBe("PRODUIT 100");
  expect(runtime.aliases).toHaveBeenCalledTimes(101);
  await click("Replier PRODUIT 100");
  expect(inputs("Libellé")).toHaveLength(0);
  expect(runtime.write).not.toHaveBeenCalled();
  expect(runtime.publish).not.toHaveBeenCalled();
});

it("retains blank and zero drafts through folding, another occurrence, regrouping and a blocked publication", async () => {
  runtime.detail!.lines[1]!.line.rawLabel = "PRODUIT 0";
  await mount();
  await click("Examiner PRODUIT 0");
  await act(async () => inputs("Poids (kg)")[0]!.props.onChangeText(""));
  await act(async () => inputs("Montant (€)")[0]!.props.onChangeText("0"));
  await click("Suivante");
  expect(inputs("Libellé")[0]!.props.value).toBe("PRODUIT 0");
  await click("Précédente");
  expect(inputs("Poids (kg)")[0]!.props.value).toBe("");
  expect(inputs("Montant (€)")[0]!.props.value).toBe("0");
  await click("Replier PRODUIT 0");
  await click("Examiner PRODUIT 12");
  await click("Replier PRODUIT 12");
  runtime.detail = {
    ...runtime.detail!,
    lines: runtime.detail!.lines.map((d, i) =>
      i === 0
        ? { ...d, line: { ...d.line, rawLabel: "NOUVEAU GROUPE", version: 2 } }
        : d,
    ),
  };
  await click("Actualiser le ticket");
  await click("Examiner NOUVEAU GROUPE");
  expect(inputs("Poids (kg)")[0]!.props.value).toBe("");
  expect(inputs("Montant (€)")[0]!.props.value).toBe("0");
  expect(button("Enregistrer la ligne").props.disabled).toBe(true);
  await click("Replier NOUVEAU GROUPE");
  await click("Valider la casse");
  expect(runtime.validate).toHaveBeenCalled();
  expect(runtime.publish).not.toHaveBeenCalled();
  expect(runtime.write).not.toHaveBeenCalled();
  expect(runtime.dirty.mock.lastCall?.[0]).toBe(true);
});

it("keeps the correction list progressive and opens the exact repeated source occurrence without saving", async () => {
  runtime.detail!.lines[139]!.line.rawLabel = "PRODUIT 0";
  runtime.issues = runtime.detail!.lines.map((d) => ({
    lineId: d.line.id,
    lineIndex: d.line.sourceLineIndex,
    field: "totalPrice",
    message: `Montant ${d.line.sourceLineIndex} à corriger`,
  }));
  runtime.publish.mockRejectedValue(
    new WastePublicationValidationError(runtime.issues),
  );
  await mount();
  await click("Valider la casse");
  const issueButtons = () =>
    rendered!.root
      .findAllByType("Pressable" as never)
      .filter((n) =>
        String(n.props.accessibilityLabel).includes("Voir le champ à corriger"),
      );
  expect(issueButtons()).toHaveLength(5);
  expect(inputs("Libellé")).toHaveLength(0);
  await click("Afficher les 135 autres corrections");
  expect(issueButtons()).toHaveLength(140);
  await act(async () => issueButtons()[139]!.props.onPress());
  expect(inputs("Libellé")).toHaveLength(1);
  expect(inputs("Libellé")[0]!.props.value).toBe("PRODUIT 0");
  const labels = rendered!.root
    .findAllByType("Text" as never)
    .map((n) =>
      n.children
        .filter((c) => typeof c === "string" || typeof c === "number")
        .join(""),
    );
  expect(
    labels.some(
      (label) =>
        label.includes("Occurrence 2 sur 2") &&
        label.includes("Ligne source 140"),
    ),
  ).toBe(true);
  await click("Replier PRODUIT 0");
  expect(inputs("Libellé")).toHaveLength(0);
  expect(runtime.write).not.toHaveBeenCalled();
});

it("keeps folding and issue navigation disabled during an explicit save, then keeps the saved line open and clears only its draft", async () => {
  await mount();
  await click("Examiner PRODUIT 0");
  await act(async () => inputs("Montant (€)")[0]!.props.onChangeText("0"));
  let finish!: () => void;
  runtime.write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          runtime.detail = {
            ...runtime.detail!,
            lines: runtime.detail!.lines.map((d, i) =>
              i
                ? d
                : { ...d, line: { ...d.line, totalPrice: "0", version: 2 } },
            ),
          };
          resolve();
        };
      }),
  );
  await click("Enregistrer la ligne");
  expect(button("Replier PRODUIT 0").props.disabled).toBe(true);
  expect(button("Examiner PRODUIT 1").props.disabled).toBe(true);
  expect(inputs("Montant (€)")[0]!.props.editable).toBe(false);
  await act(async () => finish());
  expect(inputs("Libellé")).toHaveLength(1);
  expect(inputs("Montant (€)")[0]!.props.value).toBe("0");
  expect(button("Replier PRODUIT 0").props.disabled).toBe(false);
  expect(runtime.write).toHaveBeenCalledTimes(1);
  expect(runtime.write.mock.lastCall?.[2].totalPrice).toBe("0");
  expect(runtime.dirty.mock.lastCall).toEqual([false, false]);
});

it("keeps repeated occurrences accessible after saving without saving another occurrence's draft", async () => {
  runtime.detail!.lines[1]!.line.rawLabel = "PRODUIT 0";
  runtime.write.mockImplementation(async () => {
    runtime.detail = {
      ...runtime.detail!,
      lines: runtime.detail!.lines.map((draft, index) =>
        index === 0
          ? { ...draft, line: { ...draft.line, totalPrice: "0", version: 2 } }
          : draft,
      ),
    };
  });
  await mount();
  await click("Examiner PRODUIT 0");
  await click("Suivante");
  await act(async () => inputs("Montant (€)")[0]!.props.onChangeText("7"));
  await click("Précédente");
  await act(async () => inputs("Montant (€)")[0]!.props.onChangeText("0"));
  await click("Enregistrer la ligne");
  expect(inputs("Libellé")).toHaveLength(1);
  expect(inputs("Montant (€)")[0]!.props.value).toBe("0");
  await click("Suivante");
  expect(inputs("Montant (€)")[0]!.props.value).toBe("7");
  expect(runtime.write).toHaveBeenCalledTimes(1);
  expect(runtime.write.mock.lastCall?.[1]).toBe("line-0");
  expect(runtime.publish).not.toHaveBeenCalled();
});

it("keeps the group open after product confirmation so the next source occurrence can be reviewed", async () => {
  const first = runtime.detail!.lines[0]!;
  first.line.matchedProductId = "11111111-1111-4111-8111-111111111111";
  runtime.detail!.lines[1]!.line.rawLabel = first.line.rawLabel;
  runtime.issues = [
    {
      lineId: first.line.id,
      lineIndex: first.line.sourceLineIndex,
      field: "product",
      message: "Produit à confirmer",
    },
  ];
  runtime.publish.mockRejectedValue(
    new WastePublicationValidationError(runtime.issues),
  );
  runtime.select.mockImplementation(async () => {
    runtime.detail = {
      ...runtime.detail!,
      lines: runtime.detail!.lines.map((draft, index) =>
        index === 0
          ? {
              ...draft,
              line: { ...draft.line, matchStatus: "MATCHED", version: 2 },
            }
          : draft,
      ),
    };
    runtime.issues = [];
  });
  await mount();
  await click("Valider la casse");
  await click("Examiner PRODUIT 0");
  await click("Reconfirmer le produit associé");
  expect(inputs("Libellé")).toHaveLength(1);
  await click("Suivante");
  expect(inputs("Libellé")).toHaveLength(1);
  expect(runtime.select).toHaveBeenCalledExactlyOnceWith(
    runtime.detail!.receipt.id,
    first.line.id,
    first.line.matchedProductId,
    first.line.version,
  );
  expect(runtime.write).not.toHaveBeenCalled();
  expect(runtime.publish).toHaveBeenCalledTimes(1);
});
