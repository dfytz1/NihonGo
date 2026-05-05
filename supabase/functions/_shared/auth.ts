import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function getPublishableKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys["default"] ?? Object.values(keys)[0];
  }
  throw new Error(
    "Missing anon/publishable key (SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS)",
  );
}

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

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/** Validates JWT and returns the auth user (sub). */
export async function getUserFromRequest(
  req: Request,
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: string }> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = getPublishableKey();
  const jwt = getBearerToken(req);
  if (!jwt) return { error: "Missing Authorization bearer token" };

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return { error: error?.message ?? "Invalid session" };
  return { user: data.user };
}

/** Service role client — only use after JWT user is verified. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = getSecretServiceKey();
  return createClient(url, key);
}
