import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";

const DeviceIdentityContext = createContext<string | null>(null);

/**
 * The browser build is a UI preview. The production data path is native SQLite.
 */
export function DatabaseProvider({ children }: PropsWithChildren) {
  const [deviceId] = useState(() => {
    const existing = globalThis.localStorage?.getItem("preview.device-id");
    if (existing) return existing;
    const created = globalThis.crypto.randomUUID();
    globalThis.localStorage?.setItem("preview.device-id", created);
    return created;
  });
  return (
    <DeviceIdentityContext.Provider value={deviceId}>
      {children}
    </DeviceIdentityContext.Provider>
  );
}

export function useLocalDatabase(): never {
  throw new Error("Local SQLite is only available in native builds.");
}

export function useDeviceIdentity() {
  const deviceId = useContext(DeviceIdentityContext);
  if (!deviceId) throw new Error("Device identity is unavailable.");
  return deviceId;
}
