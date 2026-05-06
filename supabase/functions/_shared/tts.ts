// ElevenLabs text-to-speech — API key from Edge Function secrets only (ELEVENLABS_API_KEY).

import { normalizeMp3ForStorage } from "./loudnorm.ts";

/** Per-call jitter so re-generating the same line does not sound identical (new file + varied prosody). */
function voiceSettingsForModel(modelId: string) {
  const id = modelId.toLowerCase();
  // eleven_v3 uses a different tuning surface in some accounts; keep a safe minimum.
  if (id.includes("v3")) {
    return {
      stability: 0.38 + Math.random() * 0.24,
      similarity_boost: 0.72 + Math.random() * 0.2,
      style: 0.15 + Math.random() * 0.45,
      use_speaker_boost: true,
    };
  }
  return {
    stability: 0.28 + Math.random() * 0.35,
    similarity_boost: 0.62 + Math.random() * 0.28,
    style: Math.random() * 0.35,
    use_speaker_boost: true,
  };
}

export async function synthesizeJapaneseMp3(
  text: string,
  voiceId: string,
  modelIdOverride?: string,
): Promise<Uint8Array> {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured on the server");

  const trimmed = modelIdOverride?.trim();
  const modelId =
    trimmed ||
    Deno.env.get("ELEVENLABS_MODEL_ID")?.trim() ||
    "eleven_multilingual_v2";

  const body = {
    text,
    model_id: modelId,
    voice_settings: voiceSettingsForModel(modelId),
  };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${t}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

/** TTS bytes for upload; `loudnorm_applied` is false when ffmpeg is unavailable (typical on hosted Edge). */
export async function synthesizeJapaneseMp3ForStorage(
  text: string,
  voiceId: string,
  modelIdOverride?: string,
): Promise<{ mp3: Uint8Array; loudnorm_applied: boolean }> {
  const raw = await synthesizeJapaneseMp3(text, voiceId, modelIdOverride);
  const { bytes, loudnorm_applied } = await normalizeMp3ForStorage(raw);
  return { mp3: bytes, loudnorm_applied };
}
