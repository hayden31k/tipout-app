// Release config, committed so cloud builds (Capawesome) get the real iOS key.
// `npm run build` uses a local, gitignored revenuecat.config.js instead when
// one exists (see revenuecat.config.example.js).
//
// Only RevenueCat *public* SDK keys (appl_/goog_) belong here - they ship
// inside the app anyway. Never put a secret sk_ key or the webhook secret in
// this file.
window.REVENUECAT_CONFIG = {
  apiKey: {
    ios: 'appl_jqpwdNfBotUhgXUhjZTKzqSYiNH',
    android: 'CHANGE_ME_GOOGLE_API_KEY',
  },
  // Verbose RevenueCat SDK logging - off for release builds.
  debug: false,
};
