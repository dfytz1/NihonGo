import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let raw: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const denied = requireAccessPin(req, raw);
  if (denied) return denied;

  return jsonResponse({ ok: true });
});
