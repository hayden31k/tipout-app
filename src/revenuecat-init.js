// Bundled by `npm run build` into vendor/revenuecat.bundle.js (see package.json).
// Configures the RevenueCat SDK on native platforms only — RevenueCat has no
// web/PWA support, and calling configure() there just rejects.
import { Capacitor } from '@capacitor/core';
import { LOG_LEVEL, PURCHASES_ERROR_CODE, Purchases } from '@revenuecat/purchases-capacitor';
import { RevenueCatUI } from '@revenuecat/purchases-capacitor-ui';

// Resolves true once configure() succeeds, false if the SDK isn't usable here
// (web/PWA, missing API key, or configure failed). The paywall awaits this
// before fetching offerings or starting a purchase.
function configure() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(false);

  const config = window.REVENUECAT_CONFIG || {};
  const platform = Capacitor.getPlatform();
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : config.apiKey && config.apiKey[platform];

  if (!apiKey) {
    console.warn(`RevenueCat: no API key configured for platform "${platform}" — skipping configure().`);
    return Promise.resolve(false);
  }
  return (config.debug ? Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG }) : Promise.resolve())
    .then(() => Purchases.configure({ apiKey }))
    .then(() => true)
    .catch((err) => {
      console.error('RevenueCat configure failed:', err);
      return false;
    });
}

window.RevenueCat = { Purchases, RevenueCatUI, PURCHASES_ERROR_CODE, ready: configure() };
