import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";

const MAX_VOICES = 120;

/** Lists ElevenLabs voices for checkbox UI (PIN-gated). */
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

  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) {
    return jsonResponse({ error: "ELEVENLABS_API_KEY is not set" }, 500);
  }

  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
  });

  if (!r.ok) {
    const t = (await r.text()).slice(0, 300);
    return jsonResponse({ error: `ElevenLabs ${r.status}`, detail: t }, 502);
  }

  let body: { voices?: Array<{ voice_id?: string; name?: string }> };
  try {
    body = await r.json() as typeof body;
  } catch {
    return jsonResponse({ error: "Bad voices JSON" }, 502);
  }

  const voices = (body.voices ?? [])
    .map((v) => ({
      voice_id: String(v.voice_id ?? ""),
      name: String(v.name ?? v.voice_id ?? ""),
    }))
    .filter((v) => v.voice_id)
    .slice(0, MAX_VOICES);

  return jsonResponse({ voices });
});
