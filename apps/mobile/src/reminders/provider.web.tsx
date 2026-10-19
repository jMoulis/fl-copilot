import { createContext, useContext, type PropsWithChildren } from "react";
const preview = {
  refresh: async () => {},
  error: undefined as string | undefined,
  available: false,
};
const Context = createContext<typeof preview | null>(null);
/** Web is a visual preview; scheduling and local reminder data belong to the native runtime. */
export function ReminderProvider({ children }: PropsWithChildren) {
  return <Context.Provider value={preview}>{children}</Context.Provider>;
}
export function useReminders() {
  const value = useContext(Context);
  if (!value) throw Error("ReminderProvider absent");
  return value;
}
