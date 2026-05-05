import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import { serviceClient } from "../_shared/auth.ts";
import { synthesizeJapaneseMp3 } from "../_shared/tts.ts";

type Body = { sentence_id: string; voice_id?: string };

const BUCKET = "sentence-audio";

function storagePath(sentenceId: string): string {
  return `${sentenceId}.mp3`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const denied = requireAccessPin(req);
  if (denied) return denied;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const sentenceId = (body.sentence_id ?? "").trim();
  if (!sentenceId) {
    return jsonResponse({ error: "sentence_id is required" }, 400);
  }

  const admin = serviceClient();

  const { data: row, error: fetchErr } = await admin
    .from("sentences")
    .select()
    .eq("id", sentenceId)
    .single();

  if (fetchErr || !row) {
    return jsonResponse({ error: "Sentence not found" }, 404);
  }

  const jp = (row.japanese_text as string ?? "").trim();
  if (!jp) {
    return jsonResponse({ error: "Japanese text is empty; translate first" }, 400);
  }

  const defaultVoice = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "";
  const voiceId = (body.voice_id ?? row.tts_voice_id ?? defaultVoice).trim();
  if (!voiceId) {
    return jsonResponse({ error: "No voice_id configured" }, 400);
  }

  await admin
    .from("sentences")
    .update({
      status: "generating_audio",
      tts_voice_id: voiceId,
      error_message: null,
    })
    .eq("id", sentenceId);

  try {
    const mp3 = await synthesizeJapaneseMp3(jp, voiceId);
    const path = storagePath(sentenceId);

    const { error: upErr } = await admin.storage.from(BUCKET).upload(
      path,
      mp3,
      { contentType: "audio/mpeg", upsert: true },
    );

    if (upErr) {
      await admin
        .from("sentences")
        .update({
          status: "failed_storage",
          error_message: upErr.message,
        })
        .eq("id", sentenceId);
      const { data: final } = await admin
        .from("sentences")
        .select()
        .eq("id", sentenceId)
        .single();
      return jsonResponse({ sentence: final, error: "Storage failed" }, 500);
    }

    await admin
      .from("sentences")
      .update({
        audio_path: path,
        status: "ready",
        error_message: null,
      })
      .eq("id", sentenceId);

    const { data: final } = await admin
      .from("sentences")
      .select()
      .eq("id", sentenceId)
      .single();

    return jsonResponse({ sentence: final });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("sentences")
      .update({
        status: "failed_audio",
        error_message: msg,
      })
      .eq("id", sentenceId);

    const { data: final } = await admin
      .from("sentences")
      .select()
      .eq("id", sentenceId)
      .single();

    return jsonResponse({ sentence: final, error: msg }, 500);
  }
});
