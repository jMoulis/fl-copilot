import {
  OutboxRepository,
  type EnqueueOutboxCommand,
  type OutboxCommand,
  type OutboxDatabase,
} from "./outbox-repository";

export interface AtomicMutationDatabase {
  withExclusiveTransactionAsync(
    task: (transaction: OutboxDatabase) => Promise<void>,
  ): Promise<void>;
}

export interface AtomicLocalMutation<T> {
  mutate(transaction: OutboxDatabase): Promise<T>;
  outbox: EnqueueOutboxCommand;
}

export interface AtomicLocalMutationResult<T> {
  value: T;
  command: OutboxCommand;
}

export async function runAtomicLocalMutation<T>(
  database: AtomicMutationDatabase,
  mutation: AtomicLocalMutation<T>,
  now?: () => string,
): Promise<AtomicLocalMutationResult<T>> {
  let value: T | undefined;
  let command: OutboxCommand | undefined;
  let mutationCompleted = false;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    value = await mutation.mutate(transaction);
    command = await new OutboxRepository(transaction, now).enqueue(
      mutation.outbox,
    );
    mutationCompleted = true;
  });

  if (!mutationCompleted || !command) {
    throw new Error(
      "Atomic local mutation completed without an Outbox command.",
    );
  }

  return { value: value as T, command };
}
