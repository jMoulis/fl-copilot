import { describe, expect, it } from "vitest";
import {
  ProcessedCommandIdentityError,
  ProcessedCommandService,
  type ProcessedCommandDocument,
  type ProcessedCommandStore,
  type ProcessedCommandTransaction,
} from "../src/sync/processed-command-service.js";

interface TestMutationContext {
  incrementDomainMutation(): void;
}

class InMemoryProcessedCommandStore implements ProcessedCommandStore<TestMutationContext> {
  private readonly commands = new Map<string, ProcessedCommandDocument>();
  private transactionQueue = Promise.resolve();
  domainMutationCount = 0;

  async findById(commandId: string) {
    return this.commands.get(commandId) ?? null;
  }

  async withTransaction<T>(
    task: (
      transaction: ProcessedCommandTransaction<TestMutationContext>,
    ) => Promise<T>,
  ) {
    const previous = this.transactionQueue;
    let release: () => void = () => {};
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const commands = new Map(this.commands);
    let domainMutationCount = this.domainMutationCount;
    try {
      const result = await task({
        context: {
          incrementDomainMutation() {
            domainMutationCount += 1;
          },
        },
        findById: async (commandId) => commands.get(commandId) ?? null,
        insert: async (command) => {
          if (commands.has(command._id)) {
            throw Object.assign(new Error("duplicate command"), {
              code: 11000,
            });
          }
          commands.set(command._id, command);
        },
      });
      this.commands.clear();
      for (const [id, command] of commands) this.commands.set(id, command);
      this.domainMutationCount = domainMutationCount;
      return result;
    } finally {
      release();
    }
  }

  isDuplicateCommandError(error: unknown) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    );
  }
}

const command = {
  commandId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
  commandType: "SYNC_TEST_ENTITY_UPSERT",
  entityType: "sync_test_entity",
  entityId: "44444444-4444-4444-8444-444444444444",
};

describe("ProcessedCommandService", () => {
  it("commits one domain mutation for concurrent duplicate commands", async () => {
    const store = new InMemoryProcessedCommandStore();
    const service = new ProcessedCommandService(
      store,
      () => new Date("2026-09-26T22:00:00.000Z"),
    );
    const mutate = async (context: TestMutationContext) => {
      context.incrementDomainMutation();
      return {
        resultStatus: "APPLIED" as const,
        resultingVersion: 1,
        responseJson: { label: "Preuve distante" },
      };
    };

    const outcomes = await Promise.all([
      service.execute(command, mutate),
      service.execute(command, mutate),
    ]);

    expect(store.domainMutationCount).toBe(1);
    expect(outcomes.map((outcome) => outcome.alreadyApplied).sort()).toEqual([
      false,
      true,
    ]);
    expect(outcomes[0]?.command).toEqual(outcomes[1]?.command);
    expect(outcomes[0]?.command).toMatchObject({
      _id: command.commandId,
      resultStatus: "APPLIED",
      resultingVersion: 1,
      responseJson: { label: "Preuve distante" },
    });
  });

  it("rolls back both the domain mutation and command record on failure", async () => {
    const store = new InMemoryProcessedCommandStore();
    const service = new ProcessedCommandService(store);

    await expect(
      service.execute(command, async (context) => {
        context.incrementDomainMutation();
        throw new Error("Domain mutation failed.");
      }),
    ).rejects.toThrow("Domain mutation failed.");

    expect(store.domainMutationCount).toBe(0);
    await expect(store.findById(command.commandId)).resolves.toBeNull();
  });

  it("rejects a command ID reused for a different command identity", async () => {
    const store = new InMemoryProcessedCommandStore();
    const service = new ProcessedCommandService(store);
    await service.execute(command, async (context) => {
      context.incrementDomainMutation();
      return { resultStatus: "APPLIED", resultingVersion: 1 };
    });

    await expect(
      service.execute(
        { ...command, storeId: "55555555-5555-4555-8555-555555555555" },
        async (context) => {
          context.incrementDomainMutation();
          return { resultStatus: "APPLIED", resultingVersion: 1 };
        },
      ),
    ).rejects.toBeInstanceOf(ProcessedCommandIdentityError);
    expect(store.domainMutationCount).toBe(1);
  });
});
