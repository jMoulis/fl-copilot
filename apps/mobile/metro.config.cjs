const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");
const config = getSentryExpoConfig(__dirname);
// Use Node's watcher by default; old system Watchman installations can stall startup.
// Opt in to a working Watchman installation with FL_USE_WATCHMAN=1.
config.resolver.useWatchman = process.env.FL_USE_WATCHMAN === "1";
module.exports = withNativeWind(config, { input: "./global.css" });
