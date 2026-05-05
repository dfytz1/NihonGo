export function pickTtsVoiceId(opts: {
  voice_id?: string;
  voice_ids?: string[];
  rowFallback?: string;
  envDefault?: string;
}): string {
  const raw = Array.isArray(opts.voice_ids) ? opts.voice_ids : [];
  const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.length) return ids[Math.floor(Math.random() * ids.length)]!;
  const one = (opts.voice_id ?? "").trim();
  if (one) return one;
  const row = (opts.rowFallback ?? "").trim();
  if (row) return row;
  return (opts.envDefault ?? "").trim();
}
