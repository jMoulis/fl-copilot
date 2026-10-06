import { describe, it, expect, vi } from "vitest";
import { ApiClientError } from "@fl-copilot/api-client";
import type { AuthSessionResponse } from "@fl-copilot/sync-contracts";
import { NativeSessionManager, SessionChangedError } from "./session-manager";

const epoch = Date.parse("2026-10-06T08:00:00Z");
function session(
  token: string,
  expires = epoch + 900_000,
): AuthSessionResponse {
  return {
    accessToken: token,
    accessTokenExpiresAt: new Date(expires).toISOString(),
    refreshToken: `refresh-${token}`,
    user: { id: "user", email: "test@example.test", displayName: "Test" },
    stores: [{ storeId: "store", name: "Test", role: "MANAGER" }],
  };
}
function error(status: number) {
  return new ApiClientError(status, {
    code: status === 401 ? "AUTH_SESSION_EXPIRED" : "NETWORK_UNAVAILABLE",
    messageFr: "Test",
    retryable: status !== 401,
  });
}
function fixture(refresh = vi.fn(async () => session("new"))) {
  let now = epoch;
  const storage = {
    load: vi.fn(
      async () =>
        null as {
          refreshToken: string;
          marker: Pick<AuthSessionResponse, "user" | "stores">;
        } | null,
    ),
    save: vi.fn(async (value: AuthSessionResponse) => {
      void value;
    }),
    clear: vi.fn(async () => {}),
  };
  const manager = new NativeSessionManager(storage, refresh, () => now);
  return {
    manager,
    storage,
    refresh,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("Native session renewal", () => {
  it("renews before expiry and resumes after a long background interval with the rotated credential", async () => {
    const f = fixture();
    await f.manager.establish(session("old"));
    expect(await f.manager.getAccessToken()).toBe("old");
    expect(f.refresh).not.toHaveBeenCalled();
    f.advance(841_000);
    expect(await f.manager.request(async (token) => token)).toBe("new");
    expect(f.refresh).toHaveBeenCalledWith("refresh-old");
    f.refresh.mockResolvedValueOnce(session("next", epoch + 3_000_000));
    f.advance(901_000);
    expect(await f.manager.getAccessToken()).toBe("next");
    expect(f.refresh).toHaveBeenLastCalledWith("refresh-new");
  });
  it("coalesces simultaneous renewals and persists one rotated refresh token", async () => {
    let release!: (value: AuthSessionResponse) => void;
    const refresh = vi.fn(
      () =>
        new Promise<AuthSessionResponse>((resolve) => {
          release = resolve;
        }),
    );
    const f = fixture(refresh);
    await f.manager.establish(session("old"));
    f.advance(901_000);
    const a = f.manager.request(async (token) => token),
      b = f.manager.request(async (token) => token);
    release(session("new", epoch + 2_000_000));
    expect(await Promise.all([a, b])).toEqual(["new", "new"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(f.storage.save).toHaveBeenCalledTimes(2);
  });
  it("replays one unauthorized request and reuses renewal for a late 401 from the same old token", async () => {
    const f = fixture();
    await f.manager.establish(session("old"));
    let rejectLater!: (error: Error) => void;
    const late = f.manager.request((token) =>
      token === "old"
        ? new Promise<string>((_r, reject) => {
            rejectLater = reject;
          })
        : Promise.resolve(token),
    );
    const request = vi.fn(async (token) => {
      if (token === "old") throw error(401);
      return token;
    });
    expect(await f.manager.request(request)).toBe("new");
    rejectLater(error(401));
    expect(await late).toBe("new");
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("keeps offline access and stored credentials when renewal cannot reach the server", async () => {
    const f = fixture(
      vi.fn(async () => {
        throw error(0);
      }),
    );
    f.storage.load.mockResolvedValue({
      refreshToken: "refresh-old",
      marker: { user: session("old").user, stores: session("old").stores },
    });
    await f.manager.restore();
    expect(f.manager.getSnapshot()).toMatchObject({
      status: "authenticated",
      sessionExpired: false,
    });
    expect(f.storage.clear).not.toHaveBeenCalled();
    f.refresh.mockResolvedValueOnce(session("new"));
    expect(await f.manager.getAccessToken()).toBe("new");
  });
  it("requires login only when the refresh credential is rejected", async () => {
    const f = fixture(
      vi.fn(async () => {
        throw error(401);
      }),
    );
    await f.manager.establish(session("old"));
    f.advance(901_000);
    await expect(f.manager.getAccessToken()).rejects.toMatchObject({
      status: 401,
    });
    expect(f.manager.getSnapshot()).toEqual({
      status: "anonymous",
      session: null,
      sessionExpired: true,
    });
    expect(f.storage.clear).toHaveBeenCalledTimes(1);
  });
  it("stops after the replay also returns 401 and does not loop or refresh permissions/server errors", async () => {
    const f = fixture();
    await f.manager.establish(session("old"));
    for (const status of [0, 403, 500])
      await expect(
        f.manager.request(async () => {
          throw error(status);
        }),
      ).rejects.toMatchObject({ status });
    expect(f.refresh).not.toHaveBeenCalled();
    const request = vi.fn(async () => {
      throw error(401);
    });
    await expect(f.manager.request(request)).rejects.toMatchObject({
      status: 401,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.manager.getSnapshot().sessionExpired).toBe(true);
  });
  it("cannot restore a logged-out session when a renewal completes late", async () => {
    let release!: (value: AuthSessionResponse) => void;
    const f = fixture(
      vi.fn(
        () =>
          new Promise<AuthSessionResponse>((resolve) => {
            release = resolve;
          }),
      ),
    );
    await f.manager.establish(session("old"));
    f.advance(901_000);
    const pending = f.manager.getAccessToken();
    const rejection =
      expect(pending).rejects.toBeInstanceOf(SessionChangedError);
    await f.manager.logout();
    release(session("new"));
    await rejection;
    expect(f.manager.getSnapshot().status).toBe("anonymous");
    expect(f.storage.save).toHaveBeenCalledTimes(1);
  });
  it("serializes logout after an in-progress secure storage write", async () => {
    const f = fixture();
    await f.manager.establish(session("old"));
    let release!: () => void;
    let saving!: () => void;
    const started = new Promise<void>((resolve) => {
      saving = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operations: string[] = [];
    f.storage.save.mockImplementationOnce(async () => {
      saving();
      await gate;
      operations.push("save");
    });
    f.storage.clear.mockImplementationOnce(async () => {
      operations.push("clear");
    });
    f.advance(901_000);
    const renewal = f.manager.getAccessToken();
    const rejection =
      expect(renewal).rejects.toBeInstanceOf(SessionChangedError);
    await started;
    const logout = f.manager.logout();
    release();
    await logout;
    await rejection;
    expect(operations).toEqual(["save", "clear"]);
    expect(f.manager.getSnapshot().status).toBe("anonymous");
  });
});
