import { z } from "zod";

export const databaseLocationSchema = z
  .object({
    version: z.literal(1),
    generation: z.uuid().nullable(),
    recoveredAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((v) => (v.generation === null) === (v.recoveredAt === null));
export type DatabaseLocation = z.infer<typeof databaseLocationSchema>;
export const initialDatabaseLocation: DatabaseLocation = {
  version: 1,
  generation: null,
  recoveredAt: null,
};

export class DatabaseStartupError extends Error {
  constructor(
    readonly kind: "CORRUPTION" | "UNAVAILABLE",
    options?: ErrorOptions,
  ) {
    super(
      kind === "CORRUPTION"
        ? "La base locale est endommagée. Vos fichiers restent conservés sur cet appareil."
        : "Les données locales ne peuvent pas être ouvertes. Réessayez sans supprimer l’application.",
      options,
    );
    this.name = "DatabaseStartupError";
  }
}

/** Only SQLite's corruption / non-database errors authorize isolation, never busy/full/IO errors. */
export function isSQLiteCorruption(reason: unknown): boolean {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && reason && !seen.has(reason); depth++) {
    seen.add(reason);
    if (typeof reason !== "object") return false;
    const error = reason as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const code = error.code;
    if (
      (typeof code === "number" &&
        Number.isInteger(code) &&
        code >= 0 &&
        [11, 26].includes(code & 255)) ||
      code === "SQLITE_CORRUPT" ||
      code === "SQLITE_NOTADB"
    )
      return true;
    if (
      typeof error.message === "string" &&
      (/\bSQLiteErrorException:\s*Error code (?:11|26):/i.test(error.message) ||
        /\b(?:SQLITE_CORRUPT|SQLITE_NOTADB)\b/.test(error.message) ||
        /^(?:database disk image is malformed|file is not a database)\b/i.test(
          error.message,
        ))
    )
      return true;
    reason = error.cause;
  }
  return false;
}

export interface DatabaseRecoveryStorage {
  readLocation(): Promise<DatabaseLocation>;
  /** New private directory + immutable manifest. Never rename/delete an existing database or original. */
  prepareLocation(previous: DatabaseLocation): Promise<DatabaseLocation>;
  /** Durable pointer update only after the candidate database was migrated and closed successfully. */
  activateLocation(
    previous: DatabaseLocation,
    next: DatabaseLocation,
  ): Promise<void>;
}

export class LocalDatabaseLifecycle<T> {
  private initialization?: Promise<T>;
  private recovering?: Promise<T>;
  private failure?: { location: DatabaseLocation; error: DatabaseStartupError };

  constructor(
    private readonly ports: {
      storage: DatabaseRecoveryStorage;
      open(location: DatabaseLocation, create: boolean): Promise<T>;
      close(database: T): Promise<void>;
      clearAuthentication(next: DatabaseLocation): Promise<void>;
    },
  ) {}

  initialize(): Promise<T> {
    if (this.recovering) return this.recovering;
    if (!this.initialization) {
      this.failure = undefined;
      this.initialization = this.openCurrent().catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }
    return this.initialization;
  }

  private async openCurrent() {
    let location: DatabaseLocation;
    try {
      location = await this.ports.storage.readLocation();
    } catch (cause) {
      this.failure = undefined;
      throw new DatabaseStartupError("UNAVAILABLE", { cause });
    }
    try {
      const database = await this.ports.open(
        location,
        location.generation === null,
      );
      this.failure = undefined;
      return database;
    } catch (cause) {
      const error =
        cause instanceof DatabaseStartupError
          ? cause
          : new DatabaseStartupError(
              isSQLiteCorruption(cause) ? "CORRUPTION" : "UNAVAILABLE",
              { cause },
            );
      this.failure = { location, error };
      throw error;
    }
  }

  /** Called only after the owner's separate confirmation in the startup error screen. */
  recover(): Promise<T> {
    if (this.recovering) return this.recovering;
    const failure = this.failure;
    if (!failure || failure.error.kind !== "CORRUPTION")
      return Promise.reject(new DatabaseStartupError("UNAVAILABLE"));
    this.recovering = this.recoverFrom(failure.location).finally(() => {
      this.recovering = undefined;
    });
    return this.recovering;
  }

  private async recoverFrom(previous: DatabaseLocation) {
    // All writes below affect a new directory. An incomplete candidate is retained, never activated.
    const next = await this.ports.storage.prepareLocation(previous);
    const candidate = await this.ports.open(next, true);
    await this.ports.close(candidate);
    // A new database/device must not silently inherit another device's refresh credentials.
    await this.ports.clearAuthentication(next);
    await this.ports.storage.activateLocation(previous, next);
    this.initialization = undefined;
    return this.openCurrent().then((database) => {
      this.initialization = Promise.resolve(database);
      return database;
    });
  }
}
