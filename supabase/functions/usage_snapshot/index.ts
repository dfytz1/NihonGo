import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";

/** Returns provider quota info where the APIs allow it (PIN-gated). */
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

  const elevenKey = Deno.env.get("ELEVENLABS_API_KEY");

  let elevenlabs: Record<string, unknown> | null = null;
  if (elevenKey) {
    let r = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": elevenKey },
    });
    if (!r.ok) {
      r = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": elevenKey },
      });
    }
    if (r.ok) {
      try {
        elevenlabs = await r.json() as Record<string, unknown>;
      } catch {
        elevenlabs = { parse_error: true };
      }
    } else {
      elevenlabs = {
        error: `HTTP ${r.status}`,
        detail: (await r.text()).slice(0, 200),
      };
    }
  }

  return jsonResponse({ elevenlabs });
});
