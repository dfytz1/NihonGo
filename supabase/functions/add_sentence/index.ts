import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAccessPin } from "../_shared/pin.ts";
import { serviceClient } from "../_shared/auth.ts";
import { translateRussianToJapanese } from "../_shared/translate.ts";
import { synthesizeJapaneseMp3 } from "../_shared/tts.ts";

type AddBody = {
  russian_text: string;
  tags?: string[];
  voice_id?: string;
  /** If false (default), returns 409 when the same Russian text already exists. */
  skip_duplicate_check?: boolean;
};

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

  let body: AddBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

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
    const { japanese, kana, model } = await translateRussianToJapanese(russian);

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
      const mp3 = await synthesizeJapaneseMp3(japanese, voiceId);
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
            audio_path: null,
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

      const { error: finErr } = await admin
        .from("sentences")
        .update({
          audio_path: path,
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
