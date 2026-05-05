import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import { serviceClient } from "../_shared/auth.ts";
import { translateRussianToJapanese } from "../_shared/translate.ts";
import { synthesizeJapaneseMp3 } from "../_shared/tts.ts";
import {
  appendTrack,
  newClipStoragePath,
  type AudioTrackRow,
} from "../_shared/tracks.ts";

type AddBody = {
  russian_text: string;
  tags?: string[];
  voice_id?: string;
  openai_model?: string;
  elevenlabs_model_id?: string;
  /** If false (default), returns 409 when the same Russian text already exists. */
  skip_duplicate_check?: boolean;
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

  const body = raw as unknown as AddBody;

  const russian = (body.russian_text ?? "").trim();
  if (!russian) {
    return jsonResponse({ error: "russian_text is required" }, 400);
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const defaultVoice = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "";
  const voiceId = (body.voice_id ?? defaultVoice).trim();
  if (!voiceId) {
    return jsonResponse({
      error: "No voice_id: set ELEVENLABS_VOICE_ID secret or pass voice_id",
    }, 400);
  }

  const elevenModel = (body.elevenlabs_model_id ?? "").trim() || undefined;
  const openaiModel = (body.openai_model ?? "").trim() || undefined;

  const admin = serviceClient();

  if (!body.skip_duplicate_check) {
    const { data: existing } = await admin
      .from("sentences")
      .select("id")
      .eq("russian_text", russian)
      .maybeSingle();
    if (existing?.id) {
      return jsonResponse({
        error: "duplicate",
        message: "This Russian sentence already exists",
        existing_id: existing.id,
      }, 409);
    }
  }

  const { data: inserted, error: insErr } = await admin
    .from("sentences")
    .insert({
      user_id: null,
      russian_text: russian,
      tags,
      status: "translating",
      tts_voice_id: voiceId,
    })
    .select()
    .single();

  if (insErr || !inserted) {
    console.error(insErr);
    return jsonResponse({ error: insErr?.message ?? "Insert failed" }, 500);
  }

  const sentenceId = inserted.id as string;

  try {
    const { japanese, kana, model } = await translateRussianToJapanese(
      russian,
      openaiModel,
    );

    const { error: trErr } = await admin
      .from("sentences")
      .update({
        japanese_text: japanese,
        kana: kana || null,
        translation_model: model,
        status: "generating_audio",
        error_message: null,
      })
      .eq("id", sentenceId);

    if (trErr) throw new Error(trErr.message);

    try {
      const mp3 = await synthesizeJapaneseMp3(japanese, voiceId, elevenModel);
      const path = newClipStoragePath(sentenceId);
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
            audio_path: null,
            audio_tracks: [],
          })
          .eq("id", sentenceId);

        const { data: final } = await admin
          .from("sentences")
          .select()
          .eq("id", sentenceId)
          .single();
        return jsonResponse({
          sentence: final,
          success: false,
          warning: "Translation saved; storage upload failed",
        });
      }

      const tracks = appendTrack([], track);

      const { error: finErr } = await admin
        .from("sentences")
        .update({
          audio_path: path,
          audio_tracks: tracks,
          status: "ready",
          error_message: null,
        })
        .eq("id", sentenceId);

      if (finErr) throw new Error(finErr.message);
    } catch (ttsOrUpload: unknown) {
      const msg = ttsOrUpload instanceof Error
        ? ttsOrUpload.message
        : String(ttsOrUpload);

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

      return jsonResponse({
        sentence: final,
        success: false,
        warning: "Translation saved; audio generation failed — retry from the app",
      });
    }

    const { data: final } = await admin
      .from("sentences")
      .select()
      .eq("id", sentenceId)
      .single();

    return jsonResponse({ sentence: final, success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("sentences")
      .update({
        status: "failed_translation",
        error_message: msg,
      })
      .eq("id", sentenceId);

    const { data: final } = await admin
      .from("sentences")
      .select()
      .eq("id", sentenceId)
      .single();

    return jsonResponse({
      sentence: final,
      success: false,
      error: "translation",
      message: "Translation failed",
    });
  }
});
