import type { ClientSession, Db } from "mongodb";
import type { DatabaseService } from "../database/types.js";

export const processedCommandResultStatuses = [
  "APPLIED",
  "REJECTED",
  "CONFLICT",
] as const;

export type ProcessedCommandResultStatus =
  (typeof processedCommandResultStatuses)[number];

export interface ProcessedCommandDocument {
  _id: string;
  storeId: string;
  deviceId: string;
  commandType: string;
  resultStatus: ProcessedCommandResultStatus;
  entityType: string;
  entityId: string;
  resultingVersion: number | null;
  responseJson?: unknown;
  processedAt: Date;
}

export interface ProcessCommandInput {
  commandId: string;
  storeId: string;
  deviceId: string;
  commandType: string;
  entityType: string;
  entityId: string;
}

export interface CommandMutationResult {
  resultStatus: ProcessedCommandResultStatus;
  resultingVersion?: number | null;
  responseJson?: unknown;
}

export interface ProcessedCommandOutcome {
  alreadyApplied: boolean;
  command: ProcessedCommandDocument;
}

export class ProcessedCommandIdentityError extends Error {
  constructor(commandId: string) {
    super(`Processed command identity does not match: ${commandId}.`);
    this.name = "ProcessedCommandIdentityError";
  }
}

export interface ProcessedCommandTransaction<TContext> {
  context: TContext;
  findById(commandId: string): Promise<ProcessedCommandDocument | null>;
  insert(command: ProcessedCommandDocument): Promise<void>;
}

export interface ProcessedCommandStore<TContext> {
  findById(commandId: string): Promise<ProcessedCommandDocument | null>;
  withTransaction<T>(
    task: (transaction: ProcessedCommandTransaction<TContext>) => Promise<T>,
  ): Promise<T>;
  isDuplicateCommandError(error: unknown): boolean;
}

export class ProcessedCommandService<TContext> {
  constructor(
    private readonly store: ProcessedCommandStore<TContext>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    input: ProcessCommandInput,
    mutate: (context: TContext) => Promise<CommandMutationResult>,
  ): Promise<ProcessedCommandOutcome> {
    const existing = await this.store.findById(input.commandId);
    if (existing) return alreadyApplied(input, existing);

    try {
      return await this.store.withTransaction(async (transaction) => {
        const concurrent = await transaction.findById(input.commandId);
        if (concurrent) return alreadyApplied(input, concurrent);

        const result = await mutate(transaction.context);
        const command: ProcessedCommandDocument = {
          _id: input.commandId,
          storeId: input.storeId,
          deviceId: input.deviceId,
          commandType: input.commandType,
          resultStatus: result.resultStatus,
          entityType: input.entityType,
          entityId: input.entityId,
          resultingVersion: result.resultingVersion ?? null,
          ...(result.responseJson === undefined
            ? {}
            : { responseJson: result.responseJson }),
          processedAt: this.now(),
        };
        await transaction.insert(command);
        return { alreadyApplied: false, command };
      });
    } catch (error) {
      if (!this.store.isDuplicateCommandError(error)) throw error;
      const concurrent = await this.store.findById(input.commandId);
      if (!concurrent) throw error;
      return alreadyApplied(input, concurrent);
    }
  }
}

function alreadyApplied(
  input: ProcessCommandInput,
  command: ProcessedCommandDocument,
): ProcessedCommandOutcome {
  if (
    command.storeId !== input.storeId ||
    command.deviceId !== input.deviceId ||
    command.commandType !== input.commandType ||
    command.entityType !== input.entityType ||
    command.entityId !== input.entityId
  ) {
    throw new ProcessedCommandIdentityError(input.commandId);
  }
  return { alreadyApplied: true, command };
}

export interface MongoCommandMutationContext {
  database: Db;
  session: ClientSession;
}

class MongoProcessedCommandStore implements ProcessedCommandStore<MongoCommandMutationContext> {
  constructor(private readonly databaseService: DatabaseService) {}

  async findById(commandId: string) {
    const database = await this.databaseService.getDb();
    return database
      .collection<ProcessedCommandDocument>("processedCommands")
      .findOne({ _id: commandId });
  }

  async withTransaction<T>(
    task: (
      transaction: ProcessedCommandTransaction<MongoCommandMutationContext>,
    ) => Promise<T>,
  ) {
    const database = await this.databaseService.getDb();
    const session = database.client.startSession();
    let result: T | undefined;
    let completed = false;

    try {
      await session.withTransaction(async () => {
        const collection =
          database.collection<ProcessedCommandDocument>("processedCommands");
        result = await task({
          context: { database, session },
          findById: (commandId) =>
            collection.findOne({ _id: commandId }, { session }),
          insert: async (command) => {
            await collection.insertOne(command, { session });
          },
        });
        completed = true;
      });
    } finally {
      await session.endSession();
    }

    if (!completed) {
      throw new Error("Processed command transaction did not commit.");
    }
    return result as T;
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

export function createMongoProcessedCommandService(
  database: DatabaseService,
  now?: () => Date,
) {
  return new ProcessedCommandService(
    new MongoProcessedCommandStore(database),
    now,
  );
}
