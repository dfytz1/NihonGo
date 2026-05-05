import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import {
  hasMultilingualFamilyModel,
  isRecommendedForJapanese,
} from "./japanese_rank.ts";

const MAX_VOICES = 120;

type VoiceOut = {
  voice_id: string;
  name: string;
  /** Verified Japanese / explicit JP metadata from ElevenLabs. */
  good_for_japanese: boolean;
  /** Multilingual or v2.5–family HQ model IDs — usually works with eleven_multilingual_* for JP. */
  multilingual_eligible: boolean;
};

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

  let body: { voices?: Record<string, unknown>[] };
  try {
    body = await r.json() as typeof body;
  } catch {
    return jsonResponse({ error: "Bad voices JSON" }, 502);
  }

  const rawVoices = body.voices ?? [];
  const voices: VoiceOut[] = [];

  for (const rv of rawVoices) {
    const voice_id = String(rv.voice_id ?? "");
    if (!voice_id) continue;
    const name = String(rv.name ?? voice_id);
    const good = isRecommendedForJapanese(rv);
    const mult = hasMultilingualFamilyModel(rv);
    voices.push({
      voice_id,
      name,
      good_for_japanese: good,
      multilingual_eligible: mult,
    });
  }

  voices.sort((a, b) => {
    if (a.good_for_japanese !== b.good_for_japanese) {
      return a.good_for_japanese ? -1 : 1;
    }
    if (a.multilingual_eligible !== b.multilingual_eligible) {
      return a.multilingual_eligible ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "ru");
  });

  return jsonResponse({ voices: voices.slice(0, MAX_VOICES) });
});
