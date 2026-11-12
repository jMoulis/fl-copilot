import { expect, it } from "vitest";
import { followsChatEnd, type ChatScrollPosition } from "./chat-scroll";

it("follows streamed growth until the reader deliberately scrolls up, then resumes only at the end", () => {
  let previous: ChatScrollPosition | undefined,
    following = true;
  const scroll = (offset: number, height: number, viewport = 500) => {
    const current = { offset, height, viewport };
    following = followsChatEnd(following, previous, current);
    previous = current;
    return following;
  };
  expect(scroll(0, 2000)).toBe(true); // First layout must not cancel the initial scroll to end.
  expect(scroll(1500, 2000)).toBe(true);
  expect(scroll(1500, 2400)).toBe(true); // New response, no user scroll.
  expect(scroll(1700, 2400)).toBe(true); // Programmatic travel toward the end.
  expect(scroll(1900, 2400)).toBe(true);
  expect(scroll(1550, 2400)).toBe(false); // Reader returns to older content.
  expect(scroll(1550, 2700)).toBe(false); // Tokens cannot steal their position.
  expect(scroll(1850, 2700)).toBe(false);
  expect(scroll(2180, 2700)).toBe(true);
});

it("preserves the reader’s intent across keyboard resizing and prepended history", () => {
  const before = { offset: 1400, height: 2000, viewport: 600 };
  expect(
    followsChatEnd(true, before, { offset: 1400, height: 2000, viewport: 300 }),
  ).toBe(true);
  expect(
    followsChatEnd(false, before, {
      offset: 1400,
      height: 2200,
      viewport: 300,
    }),
  ).toBe(false);
  expect(
    followsChatEnd(false, before, {
      offset: 2400,
      height: 3500,
      viewport: 600,
    }),
  ).toBe(false);
});

it("ignores layout corrections and keyboard events until an actual reader gesture", () => {
  const previous = { offset: 1500, height: 2200, viewport: 500 };
  const shifted = { offset: 1300, height: 2200, viewport: 500 };
  expect(followsChatEnd(true, previous, shifted, false)).toBe(true);
  expect(followsChatEnd(true, previous, shifted, true)).toBe(false);
  // A shrinking layout must not pull a reader back into automatic following.
  expect(
    followsChatEnd(
      false,
      shifted,
      { offset: 1300, height: 1800, viewport: 500 },
      false,
    ),
  ).toBe(false);
});
