export async function captureStorePosition(
  deps: {
    requestPermission: () => Promise<boolean>;
    servicesEnabled: () => Promise<boolean>;
    readPosition: () => Promise<{ latitude: number; longitude: number }>;
    now: () => string;
  },
  timeoutMs = 15000,
) {
  if (!(await deps.requestPermission())) throw Error("LOCATION_DENIED");
  if (!(await deps.servicesEnabled())) throw Error("LOCATION_DISABLED");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const coords = await Promise.race([
      deps.readPosition(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("LOCATION_TIMEOUT")), timeoutMs);
      }),
    ]);
    if (
      !Number.isFinite(coords.latitude) ||
      !Number.isFinite(coords.longitude) ||
      Math.abs(coords.latitude) > 90 ||
      Math.abs(coords.longitude) > 180
    )
      throw Error("LOCATION_INVALID");
    return {
      latitude: Math.round(coords.latitude * 10000) / 10000,
      longitude: Math.round(coords.longitude * 10000) / 10000,
      capturedAt: deps.now(),
      source: "DEVICE" as const,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
