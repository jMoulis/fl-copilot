import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  getSize: vi.fn().mockResolvedValue({ width: 640, height: 480 }),
  unsupportedGetter: vi.fn(() => {
    throw Error("NativeEventEmitter requires a non-null argument");
  }),
}));
vi.mock("react-native", () =>
  Object.defineProperty(
    {
      Image: { getSize: state.getSize },
    },
    "PushNotificationIOS",
    { enumerable: true, get: state.unsupportedGetter },
  ),
);
it("reads image dimensions without evaluating unrelated legacy native modules", async () => {
  const { readNativeImageSize } = await import("./image-size");
  await expect(readNativeImageSize("file:///photo.jpg")).resolves.toEqual({
    width: 640,
    height: 480,
  });
  expect(state.getSize).toHaveBeenCalledWith("file:///photo.jpg");
  expect(state.unsupportedGetter).not.toHaveBeenCalled();
});
