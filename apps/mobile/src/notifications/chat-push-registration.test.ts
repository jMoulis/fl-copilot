import { expect, it, vi } from "vitest";
import {
  ChatPushRegistration,
  type ChatPushState,
} from "./chat-push-registration";
function fixture(value: string | null = null) {
  let current = true;
  const states: ChatPushState[] = [],
    save = vi.fn(async (token: string | null) => {
      void token;
    });
  const ports = {
    current: () => current,
    read: async () => value,
    write: async (v: string) => {
      value = v;
    },
    permission: vi.fn(async (request: boolean) => {
      void request;
      return true;
    }),
    token: vi.fn(async () => "token"),
    save,
    publish: (s: ChatPushState) => states.push(s),
  };
  return {
    ports,
    controller: new ChatPushRegistration(ports),
    states,
    save,
    value: () => value,
    leave: () => {
      current = false;
    },
  };
}
it("does not request permission or register a disabled fresh install", async () => {
  const f = fixture();
  await f.controller.refresh();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.ports.permission).not.toHaveBeenCalled();
});
it("registers opt-in and refreshes a changed token without another permission prompt", async () => {
  const f = fixture();
  await f.controller.setEnabled(true);
  f.ports.token.mockResolvedValue("rotated");
  await f.controller.refresh();
  expect(f.save.mock.calls).toEqual([["token"], ["rotated"]]);
  expect(f.ports.permission.mock.calls.filter(([r]) => r)).toHaveLength(1);
});
it("refused permission does not enable or register", async () => {
  const f = fixture();
  f.ports.permission.mockResolvedValue(false);
  await f.controller.setEnabled(true);
  expect(f.value()).toBe(null);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.states.at(-1)?.error).toBeTruthy();
});
it("retains opt-in and a useful error when obtaining the native token fails", async () => {
  const f = fixture();
  f.ports.token.mockRejectedValue(Error("private detail"));
  await f.controller.setEnabled(true);
  expect(f.value()).toBe("1");
  expect(f.states.at(-1)?.error).not.toContain("private");
  expect(f.states.at(-1)?.enabled).toBe(true);
});
it("clears remote registration when OS permission was revoked", async () => {
  const f = fixture("1");
  f.ports.permission.mockResolvedValue(false);
  await f.controller.refresh();
  expect(f.save).toHaveBeenCalledWith(null);
  expect(f.states.at(-1)?.error).toBeTruthy();
});
it("retries a failed disable on foreground without silently re-enabling", async () => {
  const f = fixture("1");
  f.save.mockRejectedValueOnce(Error("offline"));
  await f.controller.setEnabled(false);
  expect(f.value()).toBe("pending-disable");
  await f.controller.refresh();
  expect(f.value()).toBe("0");
  expect(f.save.mock.calls).toEqual([[null], [null]]);
});
it("serializes a disable after a blocked enable so the last remote write is null", async () => {
  const f = fixture();
  let release!: () => void;
  f.ports.token.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve("token");
      }),
  );
  const enable = f.controller.setEnabled(true);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const disable = f.controller.setEnabled(false);
  release();
  await Promise.all([enable, disable]);
  expect(f.save.mock.calls).toEqual([["token"], [null]]);
  expect(f.value()).toBe("0");
});
it("a late token from another owner/context cannot register or update UI", async () => {
  const f = fixture("1");
  f.ports.token.mockImplementation(async () => {
    f.leave();
    return "late";
  });
  await f.controller.refresh();
  expect(f.save).not.toHaveBeenCalled();
});
