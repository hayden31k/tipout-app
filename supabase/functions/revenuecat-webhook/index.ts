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
// TRANSFER events (a restore moved purchases between App User IDs) carry no
// app_user_id. Instead they have transferred_from / transferred_to string
// arrays of every id involved, anonymous aliases included - see
// https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
// Supabase user ids in transferred_to get is_pro = true, those in
// transferred_from get is_pro = false, and anonymous ids are skipped.
//
// Responses: 200 for anything handled or deliberately ignored (so
// RevenueCat doesn't retry it), 401 for a bad secret, 500 for a database
// failure (so RevenueCat retries later).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

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

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  if (type === "TRANSFER") return handleTransfer(adminClient, event);

  const appUserId = typeof event.app_user_id === "string" ? event.app_user_id : "";

  let isPro: boolean;
  if (GRANT_EVENTS.has(type)) isPro = true;
  else if (REVOKE_EVENTS.has(type)) isPro = false;
  else {
    console.log(`revenuecat-webhook: ignored event type ${type} (app_user_id ${appUserId || "none"})`);
    return json({ received: true, ignored: `event type ${type}` });
  }

  if (!UUID_RE.test(appUserId)) {
    console.warn(`revenuecat-webhook: ${type} for non-account app_user_id ${appUserId} - ignored`);
    return json({ received: true, ignored: "app_user_id is not a Supabase user id" });
  }

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

// Keeps only Supabase user ids from a transferred_from/transferred_to array,
// lowercased and de-duplicated. Anything else (missing field, non-strings,
// $RCAnonymousID:... aliases) is dropped.
function accountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

async function handleTransfer(
  adminClient: SupabaseClient,
  event: Record<string, unknown>,
) {
  const to = accountIds(event.transferred_to);
  // An id on both sides ends up holding the purchases, so it keeps Pro.
  const from = accountIds(event.transferred_from).filter((id) => !to.includes(id));
  const skipped = [
    ...(Array.isArray(event.transferred_from) ? event.transferred_from : []),
    ...(Array.isArray(event.transferred_to) ? event.transferred_to : []),
  ].filter((v) => !(typeof v === "string" && UUID_RE.test(v)));
  if (skipped.length) {
    console.log(`revenuecat-webhook: TRANSFER skipping non-account ids ${JSON.stringify(skipped)}`);
  }
  if (!to.length && !from.length) {
    console.warn("revenuecat-webhook: TRANSFER with no Supabase user ids - ignored");
    return json({ received: true, ignored: "no Supabase user ids in transfer" });
  }

  if (to.length) {
    // Upsert, as for a purchase, so the receiving account gets Pro even
    // without a settings row yet.
    const { error } = await adminClient
      .from("user_settings")
      .upsert(to.map((user_id) => ({ user_id, is_pro: true })), { onConflict: "user_id" });
    if (error) {
      console.error(`revenuecat-webhook: TRANSFER failed to set is_pro=true for ${to.join(", ")}:`, error.message);
      return json({ error: "Database update failed" }, 500);
    }
  }
  if (from.length) {
    // Plain update: a user with no settings row already reads as not Pro.
    const { error } = await adminClient
      .from("user_settings")
      .update({ is_pro: false })
      .in("user_id", from);
    if (error) {
      console.error(`revenuecat-webhook: TRANSFER failed to set is_pro=false for ${from.join(", ")}:`, error.message);
      return json({ error: "Database update failed" }, 500);
    }
  }

  return json({ received: true, transferred_to: to, transferred_from: from });
}
