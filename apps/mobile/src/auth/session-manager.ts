import { ApiClientError } from "@fl-copilot/api-client";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";

export type SessionMarker = Pick<AuthSessionResponse, "user" | "stores">;
export type SessionView = SessionMarker &
  Partial<Pick<AuthSessionResponse, "accessToken" | "accessTokenExpiresAt">>;
export interface SessionSnapshot {
  status: "loading" | "anonymous" | "authenticated";
  session: SessionView | null;
  sessionExpired: boolean;
}
interface SessionStorage {
  load(): Promise<{ refreshToken: string; marker: SessionMarker } | null>;
  save(session: AuthSessionResponse): Promise<void>;
  clear(): Promise<void>;
}
export class SessionChangedError extends Error {
  constructor() {
    super("La session a changé. Reprenez votre action.");
  }
}

/** Access tokens live in memory; refresh credentials remain in SecureStore. */
export class NativeSessionManager {
  private snapshot: SessionSnapshot = {
    status: "loading",
    session: null,
    sessionExpired: false,
  };
  private refreshToken: string | undefined;
  private generation = 0;
  private refreshInFlight?: { generation: number; promise: Promise<string> };
  private restoration?: Promise<void>;
  private storageWrites: Promise<void> = Promise.resolve();
  private listeners = new Set<(snapshot: SessionSnapshot) => void>();

  constructor(
    private readonly storage: SessionStorage,
    private readonly refresh: (
      refreshToken: string,
    ) => Promise<AuthSessionResponse>,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener: (snapshot: SessionSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  restore() {
    this.restoration ??= this.restoreStoredSession();
    return this.restoration;
  }
  private async restoreStoredSession() {
    const generation = this.generation;
    const stored = await this.storage.load();
    if (generation !== this.generation) return;
    if (!stored) {
      this.publish({
        status: "anonymous",
        session: null,
        sessionExpired: false,
      });
      return;
    }
    this.refreshToken = stored.refreshToken;
    this.publish({
      status: "authenticated",
      session: stored.marker,
      sessionExpired: false,
    });
    try {
      await this.getAccessToken();
    } catch {
      // A transient remote failure preserves offline access. A 401 is handled by renew().
    }
  }
  async establish(session: AuthSessionResponse) {
    const generation = ++this.generation;
    await this.commit(session, generation);
  }
  async logout() {
    await this.invalidate(this.generation, false);
  }

  async getAccessToken() {
    const session = this.snapshot.session;
    if (
      session?.accessToken &&
      Date.parse(session.accessTokenExpiresAt ?? "") > this.now() + 60_000
    )
      return session.accessToken;
    return this.renew();
  }

  async request<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const token = await this.getAccessToken();
    if (generation !== this.generation) throw new SessionChangedError();
    try {
      return await operation(token);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      if (generation !== this.generation) throw new SessionChangedError();
      const renewed = await this.renew(token);
      if (generation !== this.generation) throw new SessionChangedError();
      try {
        return await operation(renewed);
      } catch (retryError) {
        if (isUnauthorized(retryError)) await this.invalidate(generation, true);
        throw retryError;
      }
    }
  }

  private renew(rejectedToken?: string): Promise<string> {
    const session = this.snapshot.session;
    if (
      rejectedToken &&
      session?.accessToken &&
      session.accessToken !== rejectedToken &&
      Date.parse(session.accessTokenExpiresAt ?? "") > this.now() + 60_000
    )
      return Promise.resolve(session.accessToken);
    if (this.refreshInFlight?.generation === this.generation)
      return this.refreshInFlight.promise;
    const generation = this.generation;
    const promise = this.refreshAndPersist(generation).finally(() => {
      if (this.refreshInFlight?.promise === promise)
        this.refreshInFlight = undefined;
    });
    this.refreshInFlight = { generation, promise };
    return promise;
  }
  private async refreshAndPersist(generation: number) {
    if (!this.refreshToken)
      throw new ApiClientError(401, {
        code: "AUTH_REQUIRED",
        messageFr: "Veuillez vous reconnecter.",
        retryable: false,
      });
    let next: AuthSessionResponse;
    try {
      next = await this.refresh(this.refreshToken);
    } catch (error) {
      if (isUnauthorized(error)) await this.invalidate(generation, true);
      throw error;
    }
    await this.commit(next, generation);
    return next.accessToken;
  }
  private async commit(next: AuthSessionResponse, generation: number) {
    await this.writeStorage(async () => {
      if (generation !== this.generation) throw new SessionChangedError();
      await this.storage.save(next);
    });
    if (generation !== this.generation) throw new SessionChangedError();
    this.refreshToken = next.refreshToken;
    this.publish({
      status: "authenticated",
      session: {
        user: next.user,
        stores: next.stores,
        accessToken: next.accessToken,
        accessTokenExpiresAt: next.accessTokenExpiresAt,
      },
      sessionExpired: false,
    });
  }
  private async invalidate(generation: number, expired: boolean) {
    if (generation !== this.generation) return;
    ++this.generation;
    this.refreshToken = undefined;
    this.publish({
      status: "anonymous",
      session: null,
      sessionExpired: expired,
    });
    await this.writeStorage(() => this.storage.clear());
  }
  private writeStorage(task: () => Promise<void>) {
    const next = this.storageWrites.then(task);
    this.storageWrites = next.catch(() => {});
    return next;
  }
  private publish(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
function isUnauthorized(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.status === 401;
}
