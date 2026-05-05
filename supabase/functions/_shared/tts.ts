// ElevenLabs text-to-speech — API key from Edge Function secrets only (ELEVENLABS_API_KEY).

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

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
    },
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${t}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}
