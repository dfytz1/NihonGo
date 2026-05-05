import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import { serviceClient } from "../_shared/auth.ts";
import { synthesizeJapaneseMp3 } from "../_shared/tts.ts";
import {
  appendTrack,
  newClipStoragePath,
  existingTracksFromRow,
  type AudioTrackRow,
} from "../_shared/tracks.ts";

type Body = {
  sentence_ids: string[];
  voice_id?: string;
  elevenlabs_model_id?: string;
};

const BUCKET = "sentence-audio";
/** Keeps a single invocation within typical Edge time limits; call again with remaining IDs if needed. */
const MAX_PER_CALL = 8;

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

  const rawIds = Array.isArray(body.sentence_ids) ? body.sentence_ids : [];
  const unique = [...new Set(rawIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) {
    return jsonResponse({ error: "sentence_ids must be a non-empty array" }, 400);
  }

  const batch = unique.slice(0, MAX_PER_CALL);
  const remainder = unique.slice(MAX_PER_CALL);

  const defaultVoice = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "";
  const voiceOverride = body.voice_id?.trim();
  const elevenModel = (body.elevenlabs_model_id ?? "").trim() || undefined;

  const admin = serviceClient();
  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const sentenceId of batch) {
    const { data: row, error: fetchErr } = await admin
      .from("sentences")
      .select()
      .eq("id", sentenceId)
      .single();

    if (fetchErr || !row) {
      results.push({ id: sentenceId, ok: false, error: "not_found" });
      continue;
    }

    const jp = (row.japanese_text as string ?? "").trim();
    if (!jp) {
      results.push({ id: sentenceId, ok: false, error: "empty_japanese" });
      continue;
    }

    const voiceId = (voiceOverride ??
      (row.tts_voice_id as string) ??
      defaultVoice).trim();
    if (!voiceId) {
      results.push({ id: sentenceId, ok: false, error: "no_voice" });
      continue;
    }

    const { error: stErr } = await admin
      .from("sentences")
      .update({
        status: "generating_audio",
        tts_voice_id: voiceId,
        error_message: null,
      })
      .eq("id", sentenceId);

    if (stErr) {
      results.push({ id: sentenceId, ok: false, error: stErr.message });
      continue;
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
        results.push({ id: sentenceId, ok: false, error: upErr.message });
        continue;
      }

      const { data: fresh, error: freshErr } = await admin
        .from("sentences")
        .select("audio_tracks,audio_path,tts_voice_id")
        .eq("id", sentenceId)
        .single();

      if (freshErr || !fresh) {
        await admin.storage.from(BUCKET).remove([path]);
        const msg = freshErr?.message ?? "refetch failed";
        await admin
          .from("sentences")
          .update({
            status: "failed_storage",
            error_message: msg,
          })
          .eq("id", sentenceId);
        results.push({ id: sentenceId, ok: false, error: msg });
        continue;
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
        results.push({ id: sentenceId, ok: false, error: dbErr.message });
        continue;
      }

      results.push({ id: sentenceId, ok: true });
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
      results.push({ id: sentenceId, ok: false, error: msg });
    }
  }

  return jsonResponse({
    results,
    remainder_ids: remainder,
    note: remainder.length
      ? `Only ${MAX_PER_CALL} processed per call; POST again with remainder_ids.`
      : undefined,
  });
});
