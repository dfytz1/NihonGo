import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** Service key — provided by Supabase runtime. Do not add custom secrets named SUPABASE_*. */
function getSecretServiceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys["default"] ?? Object.values(keys)[0];
  }
  throw new Error(
    "Missing secret service key (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS)",
  );
}

/** Service role client — use only in Edge Functions after access is gated (e.g. PIN). */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = getSecretServiceKey();
  return createClient(url, key);
}
