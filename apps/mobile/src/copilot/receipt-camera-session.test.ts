import { expect, it, vi } from "vitest";
import type { CopilotReceiptCameraSelection } from "@fl-copilot/domain";
import {
  ReceiptCameraSession,
  type ReceiptCameraPicture,
} from "./receipt-camera-session";
import type { ReceiptPhotoSelection } from "./receipt-photo-intake";
const picture = (n: number): ReceiptCameraPicture => ({
  uri: `file:///camera/${n}.jpg`,
  width: 1200,
  height: 2400,
  format: "jpg",
});
const accepted: ReceiptPhotoSelection = {
  imported: 1,
  failures: [],
  draft: {
    text: "question conservée",
    attachments: [],
    updatedAt: "2026-10-18T16:00:00Z",
  },
};
function fixture() {
  const abort = new AbortController();
  let allowed = true;
  const persist = vi.fn(async (selection: CopilotReceiptCameraSelection) => {
    expect(selection.assets.length).toBeGreaterThan(0);
    return accepted;
  });
  const session = new ReceiptCameraSession(
    { canCapture: () => allowed, signal: abort.signal },
    persist,
  );
  return {
    session,
    persist,
    abort,
    revoke: () => {
      allowed = false;
    },
  };
}
it("keeps framing volatile until explicit save, orders one ticket and freezes the accepted save across double clicks", async () => {
  const f = fixture();
  await f.session.take(async () => picture(1));
  expect(f.persist).not.toHaveBeenCalled();
  expect(f.session.snapshot()).toMatchObject({ stage: "REVIEW", busy: false });
  f.session.addView();
  await f.session.take(async () => picture(2));
  f.session.move(1, -1);
  const first = f.session.save(),
    second = f.session.save();
  expect(first).toBe(second);
  expect(f.session.snapshot().saving).toBe(true);
  await first;
  await f.session.save();
  expect(f.persist).toHaveBeenCalledTimes(1);
  expect(f.persist.mock.calls[0]?.[0]).toMatchObject({
    mode: "ONE_RECEIPT_CAMERA",
    assets: [{ uri: picture(2).uri }, { uri: picture(1).uri }],
  });
});
it("keeps the earlier photo during failed/cancelled retake, then replaces just that occurrence on success", async () => {
  const f = fixture();
  await f.session.take(async () => picture(1));
  f.session.addView();
  await f.session.take(async () => picture(2));
  f.session.retake(0);
  await expect(
    f.session.take(async () => {
      throw Error("native private detail");
    }),
  ).rejects.toThrow("COPILOT_RECEIPT_CAMERA_CAPTURE_FAILED");
  expect(f.session.snapshot().views.map((v) => v.uri)).toEqual([
    picture(1).uri,
    picture(2).uri,
  ]);
  f.session.review();
  f.session.retake(0);
  await f.session.take(async () => picture(3));
  expect(f.session.snapshot().views.map((v) => v.uri)).toEqual([
    picture(3).uri,
    picture(2).uri,
  ]);
});
it("blocks concurrent hardware requests and ignores stale returns after backgrounding without releasing a newer capture lock", async () => {
  const f = fixture();
  let release!: (p: ReceiptCameraPicture) => void;
  const first = f.session
    .take(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .catch((error) => error);
  const another = vi.fn(async () => picture(4));
  await expect(f.session.take(another)).rejects.toThrow(
    "COPILOT_RECEIPT_CAMERA_BUSY",
  );
  expect(another).not.toHaveBeenCalled();
  f.session.interruptCapture();
  let releaseSecond!: (p: ReceiptCameraPicture) => void;
  const second = f.session.take(
    () =>
      new Promise((resolve) => {
        releaseSecond = resolve;
      }),
  );
  release(picture(1));
  expect((await first).message).toBe("COPILOT_RECEIPT_CAMERA_INTERRUPTED");
  expect(f.session.snapshot().capturing).toBe(true);
  expect(f.session.snapshot().views).toHaveLength(0);
  releaseSecond(picture(2));
  await second;
  expect(f.session.snapshot().views.map((v) => v.uri)).toEqual([
    picture(2).uri,
  ]);
});
it.each(["abort", "close", "role"])(
  "does not save/accept a delayed native photo after %s",
  async (why) => {
    const f = fixture();
    let release!: (p: ReceiptCameraPicture) => void;
    const work = f.session.take(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    if (why === "abort") f.abort.abort();
    if (why === "close") f.session.close();
    if (why === "role") f.revoke();
    release(picture(1));
    await expect(work).rejects.toThrow();
    expect(f.session.snapshot().views).toHaveLength(0);
    expect(f.persist).not.toHaveBeenCalled();
  },
);
it("does not issue a database write if authority changes between Save and its asynchronous continuation", async () => {
  const f = fixture();
  await f.session.take(async () => picture(1));
  const work = f.session.save();
  f.revoke();
  await expect(work).rejects.toThrow("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
  expect(f.persist).not.toHaveBeenCalled();
  expect(f.session.snapshot().views).toHaveLength(1);
});
it("keeps review photos editable after storage failure and allows a deliberate retry", async () => {
  const f = fixture();
  await f.session.take(async () => picture(1));
  f.persist.mockRejectedValueOnce(Error("storage unavailable"));
  await expect(f.session.save()).rejects.toThrow();
  expect(f.session.snapshot()).toMatchObject({
    stage: "REVIEW",
    saved: false,
    busy: false,
  });
  expect(f.session.snapshot().views).toHaveLength(1);
  await f.session.save();
  expect(f.persist).toHaveBeenCalledTimes(2);
});
it("does not call an unsuccessful one-photo intake saved, and permits removing/replacing that view", async () => {
  const f = fixture();
  await f.session.take(async () => picture(1));
  f.persist.mockResolvedValueOnce({
    imported: 0,
    failures: [
      { filename: "photo.jpg", code: "COPILOT_RECEIPT_PHOTO_NOT_SAVED" },
    ],
    draft: null,
  });
  await expect(f.session.save()).rejects.toThrow(
    "COPILOT_RECEIPT_PHOTO_NOT_SAVED",
  );
  f.session.remove(0);
  expect(f.session.snapshot()).toMatchObject({ stage: "CAMERA", views: [] });
  await f.session.take(async () => picture(2));
  await f.session.save();
});
it("caps one ticket at five views but permits retaking/removing/reordering within that bound", async () => {
  const f = fixture();
  for (let n = 1; n <= 5; n++) {
    if (n > 1) f.session.addView();
    await f.session.take(async () => picture(n));
  }
  expect(() => f.session.addView()).toThrow(
    "COPILOT_RECEIPT_VIEW_COUNT_INVALID",
  );
  f.session.retake(4);
  await f.session.take(async () => picture(6));
  expect(f.session.snapshot().views).toHaveLength(5);
  f.session.move(4, -1);
  f.session.remove(0);
  expect(f.session.snapshot().views.map((v) => v.uri)).toEqual([
    picture(2).uri,
    picture(3).uri,
    picture(6).uri,
    picture(4).uri,
  ]);
});
it.each([
  { ...picture(1), uri: "https://example.com/photo.jpg" },
  { ...picture(1), uri: "data:image/jpeg;base64,AAAA" },
  { ...picture(1), width: 0 },
  { ...picture(1), height: NaN },
  { ...picture(1), format: "gif" },
])(
  "rejects invalid native capture metadata before accepting a view %#",
  async (value) => {
    const f = fixture();
    await expect(
      f.session.take(async () => value as ReceiptCameraPicture),
    ).rejects.toThrow("COPILOT_RECEIPT_CAMERA_CAPTURE_FAILED");
    expect(f.session.snapshot()).toMatchObject({ views: [], busy: false });
    expect(f.persist).not.toHaveBeenCalled();
  },
);
it("does not expose mutable selection state or accept repeated references to the same cached photo", async () => {
  const f = fixture();
  await f.session.take(async () => picture(1));
  f.session.snapshot().views[0]!.uri = "file:///other-store.jpg";
  expect(f.session.snapshot().views[0]!.uri).toBe(picture(1).uri);
  f.session.addView();
  await expect(f.session.take(async () => picture(1))).rejects.toThrow(
    "COPILOT_RECEIPT_CAMERA_CAPTURE_FAILED",
  );
  f.session.review();
  expect(() => f.session.move(0, -1)).toThrow();
  expect(() => f.session.remove(9)).toThrow();
});
it("keeps one PNG capture's format, and checks authority even on a completed save replay", async () => {
  const f = fixture();
  await f.session.take(async () => ({
    ...picture(1),
    uri: "file:///camera/1.png",
    format: "png",
  }));
  await f.session.save();
  expect(f.session.snapshot().views[0]?.mimeType).toBe("image/png");
  f.revoke();
  expect(() => f.session.save()).toThrow("COPILOT_RECEIPT_CAPTURE_FORBIDDEN");
  expect(f.persist).toHaveBeenCalledTimes(1);
});
