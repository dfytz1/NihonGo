import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const denied = requireAccessPin(req);
  if (denied) return denied;

  return jsonResponse({ ok: true });
});
