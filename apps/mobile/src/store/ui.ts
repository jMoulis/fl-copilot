import { create } from "zustand";
/** Ephemeral UI only; never store operational business data here. */
export const useUiStore = create<{
  aboutVisible: boolean;
  setAboutVisible: (visible: boolean) => void;
}>((set) => ({
  aboutVisible: false,
  setAboutVisible: (aboutVisible) => set({ aboutVisible }),
}));
