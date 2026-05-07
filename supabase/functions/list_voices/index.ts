import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import {
  hasMultilingualFamilyModel,
  isRecommendedForJapanese,
  verifiedLanguagesIncludeJapanese,
} from "./japanese_rank.ts";

/** Small shortlist: Japanese-tagged / Japanese-metadata voices only (no “multilingual-only” tier). */
const MAX_VOICES = 30;

type VoiceOut = {
  voice_id: string;
  name: string;
  good_for_japanese: boolean;
  multilingual_eligible: boolean;
};

async function fetchVoicesList(key: string): Promise<Record<string, unknown>[]> {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300);
    throw new Error(`ElevenLabs ${r.status}: ${t}`);
  }
  const body = await r.json() as { voices?: Record<string, unknown>[] };
  return body.voices ?? [];
}

/** Lists up to `MAX_VOICES` ElevenLabs voices that are flagged or labeled for Japanese. */
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

  let rawVoices: Record<string, unknown>[];
  try {
    rawVoices = await fetchVoicesList(key);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 502);
  }

  const jpCandidates = rawVoices.filter((rv) => isRecommendedForJapanese(rv));

  jpCandidates.sort((a, b) => {
    const va = verifiedLanguagesIncludeJapanese(a) ? 0 : 1;
    const vb = verifiedLanguagesIncludeJapanese(b) ? 0 : 1;
    if (va !== vb) return va - vb;
    const na = String(a.name ?? a.voice_id ?? "");
    const nb = String(b.name ?? b.voice_id ?? "");
    return na.localeCompare(nb, "ru");
  });

  const pickedRaw = jpCandidates.slice(0, MAX_VOICES);

  const voices: VoiceOut[] = pickedRaw.map((rv) => {
    const voice_id = String(rv.voice_id ?? "");
    const name = String(rv.name ?? voice_id);
    return {
      voice_id,
      name,
      good_for_japanese: isRecommendedForJapanese(rv),
      multilingual_eligible: hasMultilingualFamilyModel(rv),
    };
  });

  return jsonResponse({ voices });
});
