// delete-account
//
// Deletes the CALLING user's own account and all their data. Called by the
// client with the user's own session access token in the Authorization
// header - never called with the service role key from the browser.
//
// Security model:
//   1. A client built with the ANON key + the caller's own Authorization
//      header is used ONLY to ask "who is this token actually for?" via
//      auth.getUser(). This is the identity check - it can't be spoofed,
//      because it re-validates the JWT against Supabase Auth itself rather
//      than trusting a user id the client claims to be.
//   2. A SEPARATE admin client, built with the service role key (read from
//      an environment secret, never sent to or accepted from the client),
//      is used only after that identity check succeeds, and only to delete
//      rows matching the verified user's own id.
//
// Explicitly deletes shifts/restaurants/user_settings before deleting the
// auth user, rather than relying on ON DELETE CASCADE: auth.admin.deleteUser
// only cascades within the auth schema (e.g. auth.sessions) - it does NOT
// touch public-schema tables - so this is required regardless of whether
// the shifts/restaurants/user_settings foreign keys also happen to have
// ON DELETE CASCADE set. Doing both is harmless: deleting rows that a
// cascade would also have removed is a no-op, not an error.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Missing Authorization header" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    // These three are auto-provisioned by the platform for every Edge
    // Function - if any are missing, something is wrong with the deploy
    // environment itself, not the caller's request.
    return json({ error: "Server misconfiguration" }, 500);
  }

  // Step 1: verify identity. This client only ever uses the ANON key plus
  // the caller's own token - it cannot bypass RLS and is not the admin
  // client, so it's safe to build from request data.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Not authenticated" }, 401);
  }
  const userId = userData.user.id;

  // Step 2: privileged deletes, using the verified id only - never any id
  // the request body might claim.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { error: shiftsErr } = await adminClient.from("shifts").delete().eq("user_id", userId);
  if (shiftsErr) return json({ error: "Failed to delete shifts: " + shiftsErr.message }, 500);

  const { error: restaurantsErr } = await adminClient.from("restaurants").delete().eq("user_id", userId);
  if (restaurantsErr) return json({ error: "Failed to delete restaurants: " + restaurantsErr.message }, 500);

  const { error: settingsErr } = await adminClient.from("user_settings").delete().eq("user_id", userId);
  if (settingsErr) return json({ error: "Failed to delete settings: " + settingsErr.message }, 500);

  const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteUserErr) return json({ error: "Failed to delete account: " + deleteUserErr.message }, 500);

  return json({ success: true });
});
