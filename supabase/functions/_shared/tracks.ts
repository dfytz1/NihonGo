export type AudioTrackRow = {
  path: string;
  voice_id?: string;
  tts_model_id?: string;
  created_at: string;
};

export function normalizeAudioTracks(raw: unknown): AudioTrackRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AudioTrackRow[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.path !== "string" || !o.path.trim()) continue;
    out.push({
      path: o.path.trim(),
      voice_id: typeof o.voice_id === "string" ? o.voice_id : undefined,
      tts_model_id: typeof o.tts_model_id === "string" ? o.tts_model_id : undefined,
      created_at:
        typeof o.created_at === "string"
          ? o.created_at
          : new Date().toISOString(),
    });
  }
  return out;
}

export function appendTrack(
  existing: unknown,
  track: AudioTrackRow,
): AudioTrackRow[] {
  return [...normalizeAudioTracks(existing), track];
}

export function existingTracksFromRow(row: {
  audio_tracks?: unknown;
  audio_path?: string | null;
  tts_voice_id?: string | null;
}): AudioTrackRow[] {
  let cur = normalizeAudioTracks(row.audio_tracks);
  if (cur.length === 0 && row.audio_path && String(row.audio_path).trim()) {
    cur = [{
      path: String(row.audio_path).trim(),
      voice_id: typeof row.tts_voice_id === "string" ? row.tts_voice_id : undefined,
      tts_model_id: undefined,
      created_at: new Date().toISOString(),
    }];
  }
  return cur;
}

/** Unique storage object per new clip (avoids CDN/browser reuse of the same URL). */
export function newClipStoragePath(sentenceId: string): string {
  return `${sentenceId}/${crypto.randomUUID()}.mp3`;
}
