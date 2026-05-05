import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import { serviceClient } from "../_shared/auth.ts";
import { textForTts } from "../_shared/tts_text.ts";
import { synthesizeJapaneseMp3 } from "../_shared/tts.ts";
import { pickTtsVoiceId } from "../_shared/voice_pick.ts";
import {
  appendTrack,
  newClipStoragePath,
  existingTracksFromRow,
  type AudioTrackRow,
} from "../_shared/tracks.ts";

type Body = {
  sentence_id: string;
  voice_id?: string;
  voice_ids?: string[];
  elevenlabs_model_id?: string;
};

const BUCKET = "sentence-audio";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const denied = requireAccessPin(req, raw);
  if (denied) return denied;

  const body = raw as unknown as Body;

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

  const jp = textForTts(
    row.japanese_text as string ?? "",
    row.kana as string | null | undefined,
  );
  if (!jp) {
    return jsonResponse({ error: "Japanese text is empty; translate first" }, 400);
  }

  const defaultVoice = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "";
  const voiceId = pickTtsVoiceId({
    voice_id: body.voice_id,
    voice_ids: body.voice_ids,
    rowFallback: row.tts_voice_id as string,
    envDefault: defaultVoice,
  });
  if (!voiceId) {
    return jsonResponse({ error: "No voice_id configured" }, 400);
  }

  const elevenModel = (body.elevenlabs_model_id ?? "").trim() || undefined;

  const { error: stErr } = await admin
    .from("sentences")
    .update({
      status: "generating_audio",
      tts_voice_id: voiceId,
      error_message: null,
    })
    .eq("id", sentenceId);

  if (stErr) {
    return jsonResponse({ error: stErr.message, hint: "status_update" }, 500);
  }

  let path = "";
  try {
    const mp3 = await synthesizeJapaneseMp3(jp, voiceId, elevenModel);
    path = newClipStoragePath(sentenceId);
    const track: AudioTrackRow = {
      path,
      voice_id: voiceId,
      tts_model_id: elevenModel,
      created_at: new Date().toISOString(),
    };

    const { error: upErr } = await admin.storage.from(BUCKET).upload(
      path,
      mp3,
      { contentType: "audio/mpeg", upsert: false },
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
      return jsonResponse({ sentence: final, error: upErr.message }, 500);
    }

    const { data: fresh, error: freshErr } = await admin
      .from("sentences")
      .select("audio_tracks,audio_path,tts_voice_id")
      .eq("id", sentenceId)
      .single();

    if (freshErr || !fresh) {
      await admin.storage.from(BUCKET).remove([path]);
      const msg = freshErr?.message ?? "Could not reload row (audio_tracks merge)";
      await admin
        .from("sentences")
        .update({
          status: "failed_storage",
          error_message: msg,
        })
        .eq("id", sentenceId);
      return jsonResponse({ error: msg, hint: "refetch_after_upload" }, 500);
    }

    const existing = existingTracksFromRow(fresh as Record<string, unknown>);
    const tracks = appendTrack(existing, track);
    const lastPath = tracks[tracks.length - 1]!.path;

    const { error: dbErr } = await admin
      .from("sentences")
      .update({
        audio_path: lastPath,
        audio_tracks: tracks,
        status: "ready",
        error_message: null,
      })
      .eq("id", sentenceId);

    if (dbErr) {
      await admin.storage.from(BUCKET).remove([path]);
      await admin
        .from("sentences")
        .update({
          status: "failed_storage",
          error_message: dbErr.message,
        })
        .eq("id", sentenceId);
      const { data: final } = await admin
        .from("sentences")
        .select()
        .eq("id", sentenceId)
        .single();
      return jsonResponse({
        sentence: final,
        error: dbErr.message,
        hint: "Run latest DB migration if column audio_tracks is missing",
      }, 500);
    }

    const { data: final } = await admin
      .from("sentences")
      .select()
      .eq("id", sentenceId)
      .single();

    return jsonResponse({ sentence: final });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (path) {
      await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    }
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
