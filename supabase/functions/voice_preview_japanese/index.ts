import { corsHeaders } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import { synthesizeJapaneseMp3ForStorage } from "../_shared/tts.ts";

/** Short line so previews stay cheap; all samples are real Japanese TTS. */
const SAMPLE_JP = "こんにちは。これは日本語のサンプルです。";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let raw: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const denied = requireAccessPin(req, raw);
  if (denied) return denied;

  const voiceId = String(raw.voice_id ?? "").trim();
  if (!voiceId) {
    return new Response(JSON.stringify({ error: "voice_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const modelRaw = raw.elevenlabs_model_id;
  const model = typeof modelRaw === "string" ? modelRaw.trim() : "";
  const modelOpt = model || undefined;

  try {
    const mp3 = await synthesizeJapaneseMp3ForStorage(
      SAMPLE_JP,
      voiceId,
      modelOpt,
    );
    return new Response(mp3, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
