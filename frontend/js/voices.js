import { LS_VOICE, LS_VOICE_IDS } from "./state.js";

/** @type {Map<string, string>} */
let voiceCatalog = new Map();

export function setVoiceCatalog(voices) {
  voiceCatalog = new Map(
    (voices || []).map((v) => [
      String(v.voice_id),
      String(v.name ?? v.voice_id ?? ""),
    ]),
  );
}

export function voiceLabel(voiceId) {
  if (!voiceId) return "—";
  return voiceCatalog.get(String(voiceId)) ?? String(voiceId).slice(0, 12);
}

export function getSelectedVoiceIds() {
  try {
    const raw = localStorage.getItem(LS_VOICE_IDS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return [
          ...new Set(arr.map((x) => String(x).trim()).filter(Boolean)),
        ];
      }
    }
  } catch {
    /* ignore */
  }
  const legacy = (localStorage.getItem(LS_VOICE) || "").trim();
  return legacy ? [legacy] : [];
}

export function setSelectedVoiceIds(ids) {
  const cleaned = [
    ...new Set((ids || []).map((x) => String(x).trim()).filter(Boolean)),
  ];
  localStorage.setItem(LS_VOICE_IDS, JSON.stringify(cleaned));
  if (cleaned.length === 1) {
    localStorage.setItem(LS_VOICE, cleaned[0]);
  } else {
    localStorage.removeItem(LS_VOICE);
  }
}

export function pickRandomVoiceId() {
  const ids = getSelectedVoiceIds();
  if (!ids.length) return "";
  return ids[Math.floor(Math.random() * ids.length)];
}

/** Fields to merge into Edge Function JSON for TTS. */
export function buildTtsVoiceBody() {
  const ids = getSelectedVoiceIds();
  if (ids.length > 1) return { voice_ids: ids };
  if (ids.length === 1) return { voice_id: ids[0] };
  return {};
}
