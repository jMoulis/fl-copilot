const { withEntitlementsPlist } = require("expo/config-plugins");
// Register before expo-notifications: Expo executes these mods in reverse order.
// Local reminders do not register for APNs. Keep remote push out of this increment.
module.exports = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });
