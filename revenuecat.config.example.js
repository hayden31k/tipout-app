// Copy this file to revenuecat.config.js (same directory) and fill in real values.
// revenuecat.config.js is gitignored — never commit real API keys here.
//
// RevenueCat uses a separate public API key per store. Get yours from
// https://app.revenuecat.com -> Project settings -> API keys.
window.REVENUECAT_CONFIG = {
  apiKey: {
    ios: 'CHANGE_ME_APPLE_API_KEY',
    android: 'CHANGE_ME_GOOGLE_API_KEY',
  },
  // Verbose RevenueCat SDK logging — leave off in production builds.
  debug: false,
};
