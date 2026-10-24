import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { copilotKnowledgeSchema } from "@fl-copilot/domain";
import { chatFixture } from "../../../../scripts/test-chat-fixtures";
import { buildKnowledgeSuggestionMessages } from "../../../api/src/copilot/knowledge-suggestion-messages";
import { KnowledgeSuggestionCard } from "./knowledge-suggestion-card";
const runtime = vi.hoisted(() => ({
  session: undefined as unknown,
  sqlite: undefined as unknown,
  focused: true,
  push: vi.fn(),
}));
vi.mock("../auth/auth-provider", () => ({
  useAuth: () => ({ session: runtime.session }),
}));
vi.mock("../providers/database-provider", () => ({
  useLocalDatabase: () => ({ sqlite: runtime.sqlite }),
}));
vi.mock("./chat-text", () => ({ ChatText: "Text" }));
vi.mock("../components/ui", () => ({
  SectionCard: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: unknown;
  }) =>
    createElement(
      "Card",
      {},
      createElement("Text", {}, title),
      createElement("Text", {}, description),
      children as never,
    ),
  SecondaryButton: ({ label, ...props }: { label: string }) =>
    createElement("Button", { ...props, testID: "memory-button" }, label),
}));
vi.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => runtime.push(...args) },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const focused = runtime.focused;
    useEffect(() => (focused ? cb() : undefined), [focused, cb]);
  },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  runtime.focused = true;
  runtime.push.mockReset();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});
async function fixture() {
  const f = chatFixture(randomUUID),
    source = {
      ...f.message,
      text: "Nous préparons la casse chaque matin.",
      attachments: [],
    };
  const assistant = {
    ...source,
    id: randomUUID(),
    role: "ASSISTANT" as const,
    replyToMessageId: source.id,
    text: "Je propose de mémoriser cette pratique.",
  };
  const message = buildKnowledgeSuggestionMessages(
    assistant,
    [
      {
        statement: source.text,
        sources: [{ messageId: source.id, quote: source.text }],
      },
    ],
    {
      memorySuggestion: { currentUserMessageId: source.id },
      userQuestion: source.text,
    } as Parameters<typeof buildKnowledgeSuggestionMessages>[2],
  )[0]!;
  const record = copilotKnowledgeSchema.parse({
    id: message.id,
    storeId: f.storeId,
    ownerId: f.ownerId,
    scope: "USER_STORE",
    kind: "OPERATING_PRACTICE",
    statement: "Pratique privée déjà mémorisée",
    status: "ACTIVE",
    sourceMessageId: source.id,
    confirmedBy: f.ownerId,
    version: 1,
    createdAt: source.createdAt,
    updatedAt: source.createdAt,
  });
  const read = vi.fn(
    async (): Promise<{ payload_json: string; sync_state: string } | null> => ({
      payload_json: JSON.stringify(record),
      sync_state: "SYNCED",
    }),
  );
  runtime.sqlite = { getFirstAsync: read };
  runtime.session = {
    user: { id: f.ownerId },
    stores: [{ storeId: f.storeId, role: "MANAGER" }],
  };
  await act(async () => {
    tree = create(createElement(KnowledgeSuggestionCard, { message }));
  });
  return { f, message, record, read };
}
const text = () => JSON.stringify(tree!.toJSON());
async function focus(
  message: Parameters<typeof KnowledgeSuggestionCard>[0]["message"],
  value: boolean,
) {
  runtime.focused = value;
  await act(async () =>
    tree!.update(createElement(KnowledgeSuggestionCard, { message })),
  );
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it("withdraws the old saved claim during refocus, then displays actual forgetting without the old statement", async () => {
  const s = await fixture();
  expect(text()).toContain("Pratique mémorisée");
  await focus(s.message, false);
  const pending = deferred<Awaited<ReturnType<typeof s.read>>>();
  s.read.mockImplementationOnce(() => pending.promise);
  await focus(s.message, true);
  expect(text()).not.toContain("Pratique mémorisée");
  expect(text()).not.toContain(s.record.statement);
  await act(async () =>
    pending.resolve({
      payload_json: JSON.stringify({
        ...s.record,
        status: "FORGOTTEN",
        statement: "Oublié",
      }),
      sync_state: "SYNCED",
    }),
  );
  expect(text()).toContain("Information oubliée");
  expect(text()).not.toContain(s.record.statement);
});
it("does not keep claiming synchronized memory when the reread fails and opens the memory instead of a fresh proposal", async () => {
  const s = await fixture();
  await focus(s.message, false);
  s.read.mockRejectedValueOnce(Error("READ_FAILED"));
  await focus(s.message, true);
  expect(text()).not.toContain("Votre décision a été synchronisée.");
  expect(text()).not.toContain(s.record.statement);
  expect(text()).toContain("La mémoire ne peut pas être vérifiée maintenant.");
  const button = tree!.root.findByProps({ testID: "memory-button" });
  expect(button.props.disabled).toBe(false);
  await act(async () => button.props.onPress());
  expect(runtime.push).toHaveBeenCalledWith({ pathname: "/copilot-memory" });
});
it.each(["id", "storeId", "ownerId"] as const)(
  "rejects a payload with a different %s even if the SQL row was returned",
  async (field) => {
    const s = await fixture();
    await focus(s.message, false);
    s.read.mockResolvedValueOnce({
      payload_json: JSON.stringify({
        ...s.record,
        [field]: randomUUID(),
        ...(field === "ownerId"
          ? (() => {
              const id = randomUUID();
              return { ownerId: id, confirmedBy: id };
            })()
          : {}),
      }),
      sync_state: "SYNCED",
    });
    await focus(s.message, true);
    expect(text()).not.toContain(s.record.statement);
    expect(text()).not.toContain("Votre décision a été synchronisée.");
    expect(text()).toContain(
      "La mémoire ne peut pas être vérifiée maintenant.",
    );
  },
);
it("invalidates old database reads and buttons when the local database is replaced", async () => {
  const s = await fixture(),
    oldButton = tree!.root.findByProps({ testID: "memory-button" }).props
      .onPress;
  const pending = deferred<Awaited<ReturnType<typeof s.read>>>();
  runtime.sqlite = { getFirstAsync: vi.fn(() => pending.promise) };
  await act(async () =>
    tree!.update(
      createElement(KnowledgeSuggestionCard, { message: s.message }),
    ),
  );
  expect(text()).not.toContain(s.record.statement);
  await act(async () => oldButton());
  expect(runtime.push).not.toHaveBeenCalled();
  await act(async () =>
    pending.resolve({
      payload_json: JSON.stringify(s.record),
      sync_state: "SYNCED",
    }),
  );
  expect(text()).toContain(s.record.statement);
});
it("makes a retained button inert after blur and does not query an unowned message", async () => {
  const s = await fixture(),
    old = tree!.root.findByProps({ testID: "memory-button" }).props.onPress;
  await focus(s.message, false);
  await act(async () => old());
  expect(runtime.push).not.toHaveBeenCalled();
  const reads = vi.fn();
  runtime.sqlite = { getFirstAsync: reads };
  runtime.session = {
    user: { id: randomUUID() },
    stores: [{ storeId: s.f.storeId, role: "MANAGER" }],
  };
  await focus(s.message, true);
  expect(tree!.toJSON()).toBeNull();
  expect(reads).not.toHaveBeenCalled();
});
it("ignores a late result from the previous database and keeps the currently verified unsaved proposal", async () => {
  const s = await fixture();
  await focus(s.message, false);
  const old = deferred<Awaited<ReturnType<typeof s.read>>>();
  s.read.mockImplementationOnce(() => old.promise);
  await focus(s.message, true);
  const currentRead = vi.fn(async () => null);
  runtime.sqlite = { getFirstAsync: currentRead };
  await act(async () =>
    tree!.update(
      createElement(KnowledgeSuggestionCard, { message: s.message }),
    ),
  );
  expect(text()).toContain("Vérifier et mémoriser");
  await act(async () =>
    old.resolve({
      payload_json: JSON.stringify(s.record),
      sync_state: "SYNCED",
    }),
  );
  expect(text()).not.toContain(s.record.statement);
  await act(async () =>
    tree!.root.findByProps({ testID: "memory-button" }).props.onPress(),
  );
  expect(runtime.push).toHaveBeenCalledWith({
    pathname: "/copilot-memory",
    params: { proposal: s.message.id },
  });
  expect(currentRead).toHaveBeenCalledTimes(1);
});
it("keeps a current verified result across ordinary message rerenders without extra reads", async () => {
  const s = await fixture();
  for (let i = 0; i < 5; i++)
    await act(async () =>
      tree!.update(
        createElement(KnowledgeSuggestionCard, { message: { ...s.message } }),
      ),
    );
  expect(s.read).toHaveBeenCalledTimes(1);
  expect(text()).toContain(s.record.statement);
});
