import { Platform } from "react-native";

export type AppEnvironment = "development" | "staging" | "production";

export function getAppEnvironment(): AppEnvironment {
  const value = process.env.EXPO_PUBLIC_APP_ENV;
  if (value === "staging" || value === "production") return value;
  return "development";
}

function defaultDevelopmentApiUrl() {
  if (Platform.OS === "android") return "http://10.0.2.2:3000";
  return "http://127.0.0.1:3000";
}

export function getApiBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    if (!/^https?:\/\//u.test(configured)) {
      throw new Error(
        "EXPO_PUBLIC_API_URL doit être une URL HTTP ou HTTPS absolue.",
      );
    }
    return configured.replace(/\/+$/u, "");
  }

  if (getAppEnvironment() !== "development") {
    throw new Error(
      "EXPO_PUBLIC_API_URL est requise pour staging et production.",
    );
  }

  return defaultDevelopmentApiUrl();
}
