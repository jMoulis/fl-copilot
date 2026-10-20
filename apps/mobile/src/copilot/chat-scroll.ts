export interface ChatScrollPosition {
  offset: number;
  height: number;
  viewport: number;
}
/** Growing an answer is not a user gesture away from the end of the conversation. */
export function followsChatEnd(
  following: boolean,
  previous: ChatScrollPosition | undefined,
  current: ChatScrollPosition,
) {
  if (current.height - current.viewport - current.offset < 80) return true;
  if (!previous || previous.viewport !== current.viewport) return following;
  return current.offset < previous.offset - 1 ? false : following;
}
