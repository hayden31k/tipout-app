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

const ready = configure();

// Links RevenueCat's customer to the signed-in Supabase user, so the
// revenuecat-webhook Edge Function receives the real user id as app_user_id
// and knows whose user_settings.is_pro to update. logIn() also merges any
// purchases made while anonymous into that account. Pass null on sign-out to
// go back to a fresh anonymous id. Calls are chained so rapid auth changes
// apply in order; `identified` resolves once the latest one has finished
// (never rejects), and purchases wait on it.
let lastUserId;
let identified = Promise.resolve();
function setUser(userId) {
  userId = userId || null;
  if (userId === lastUserId) return identified;
  lastUserId = userId;
  identified = identified.then(async () => {
    if (!(await ready)) return;
    try {
      if (userId) {
        await Purchases.logIn({ appUserID: userId });
      } else {
        // logOut() rejects when the current customer is already anonymous.
        const { isAnonymous } = await Purchases.isAnonymous();
        if (!isAnonymous) await Purchases.logOut();
      }
    } catch (err) {
      console.error('RevenueCat ' + (userId ? 'logIn' : 'logOut') + ' failed:', err);
    }
  });
  return identified;
}

window.RevenueCat = {
  Purchases, RevenueCatUI, PURCHASES_ERROR_CODE, ready, setUser,
  get identified() { return identified; },
};
