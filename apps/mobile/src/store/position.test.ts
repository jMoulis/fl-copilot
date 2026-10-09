import { it, expect, vi } from "vitest";
import { captureStorePosition } from "./position";
const deps = () => ({
  requestPermission: async () => true,
  servicesEnabled: async () => true,
  readPosition: vi.fn(async () => ({
    latitude: 48.9123456,
    longitude: 2.2934567,
  })),
  now: () => "2026-10-09T08:00:00.000Z",
});
it("only captures on explicit call, stores a rounded fixed point and never starts a watch", async () => {
  const d = deps();
  expect(d.readPosition).not.toHaveBeenCalled();
  expect(await captureStorePosition(d)).toEqual({
    latitude: 48.9123,
    longitude: 2.2935,
    capturedAt: d.now(),
    source: "DEVICE",
  });
  expect(d.readPosition).toHaveBeenCalledTimes(1);
});
it("refusal/disabled service leaves coordinate capture unavailable without invoking GPS", async () => {
  const d = deps();
  await expect(
    captureStorePosition({ ...d, requestPermission: async () => false }),
  ).rejects.toThrow("DENIED");
  await expect(
    captureStorePosition({ ...d, servicesEnabled: async () => false }),
  ).rejects.toThrow("DISABLED");
  expect(d.readPosition).not.toHaveBeenCalled();
});
it("bounds a stalled lookup and rejects invalid provider coordinates", async () => {
  await expect(
    captureStorePosition(
      { ...deps(), readPosition: () => new Promise(() => {}) },
      5,
    ),
  ).rejects.toThrow("TIMEOUT");
  await expect(
    captureStorePosition({
      ...deps(),
      readPosition: async () => ({ latitude: NaN, longitude: 2 }),
    }),
  ).rejects.toThrow("INVALID");
});
