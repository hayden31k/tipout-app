// revenuecat-webhook
//
// Receives RevenueCat subscription events and keeps user_settings.is_pro in
// sync. This is the ONLY place is_pro gets set to true - the client never
// writes it (a trigger blocks anon/authenticated writes to that column).
//
// Security model:
//   1. RevenueCat calls this server-to-server with no Supabase JWT, so
//      verify_jwt is off for this function (see config.toml). Instead, every
//      request must carry the shared secret configured in RevenueCat's
//      webhook "Authorization header value", which must equal the
//      REVENUECAT_WEBHOOK_SECRET Edge Function secret exactly. Anything else
//      is rejected before the body is even parsed.
//   2. The service role key (auto-provisioned env var, never sent to or
//      accepted from the caller) is used only after that check passes.
//   3. app_user_id is the Supabase user id because the app calls
//      Purchases.logIn(user.id) on sign-in. Anonymous RevenueCat ids
//      ($RCAnonymousID:...) can't be mapped to an account and are ignored.
//
// Responses: 200 for anything handled or deliberately ignored (so
// RevenueCat doesn't retry it), 401 for a bad secret, 500 for a database
// failure (so RevenueCat retries later).

import { createClient } from "jsr:@supabase/supabase-js@2";

// Events that mean the user currently has access.
const GRANT_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION"]);
// Only EXPIRATION removes access. CANCELLATION just turns off auto-renew -
// the user keeps Pro until the paid period ends, when EXPIRATION arrives.
const REVOKE_EVENTS = new Set(["EXPIRATION"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time comparison so response timing doesn't leak the secret.
function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfiguration" }, 500);
  }

  // RevenueCat sends the configured value verbatim; also accept it with a
  // "Bearer " prefix in case it's entered that way in the dashboard.
  const authHeader = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(authHeader, WEBHOOK_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let event: Record<string, unknown> | undefined;
  try {
    event = (await req.json())?.event;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!event || typeof event.type !== "string") {
    return json({ error: "Missing event" }, 400);
  }

  const type = event.type;
  const appUserId = typeof event.app_user_id === "string" ? event.app_user_id : "";

  let isPro: boolean;
  if (GRANT_EVENTS.has(type)) isPro = true;
  else if (REVOKE_EVENTS.has(type)) isPro = false;
  else return json({ received: true, ignored: `event type ${type}` });

  if (!UUID_RE.test(appUserId)) {
    console.warn(`revenuecat-webhook: ${type} for non-account app_user_id ${appUserId} - ignored`);
    return json({ received: true, ignored: "app_user_id is not a Supabase user id" });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Upsert so a purchase still lands if this user has no settings row yet.
  const { error } = await adminClient
    .from("user_settings")
    .upsert({ user_id: appUserId, is_pro: isPro }, { onConflict: "user_id" });
  if (error) {
    console.error(`revenuecat-webhook: failed to set is_pro=${isPro} for ${appUserId}:`, error.message);
    return json({ error: "Database update failed" }, 500);
  }

  return json({ received: true, user_id: appUserId, is_pro: isPro });
});
