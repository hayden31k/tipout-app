// Bundled by `npm run build` into vendor/revenuecat.bundle.js (see package.json).
// Configures the RevenueCat SDK on native platforms only — RevenueCat has no
// web/PWA support, and calling configure() there just rejects.
import { Capacitor } from '@capacitor/core';
import { LOG_LEVEL, Purchases } from '@revenuecat/purchases-capacitor';
import { RevenueCatUI } from '@revenuecat/purchases-capacitor-ui';

// Exposed for future paywall/purchase UI work; nothing calls these yet.
window.RevenueCat = { Purchases, RevenueCatUI };

if (Capacitor.isNativePlatform()) {
  const config = window.REVENUECAT_CONFIG || {};
  const platform = Capacitor.getPlatform();
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : config.apiKey && config.apiKey[platform];

  if (!apiKey) {
    console.warn(`RevenueCat: no API key configured for platform "${platform}" — skipping configure().`);
  } else {
    (config.debug ? Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG }) : Promise.resolve())
      .then(() => Purchases.configure({ apiKey }))
      .catch((err) => console.error('RevenueCat configure failed:', err));
  }
}
