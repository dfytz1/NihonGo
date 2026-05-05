/** Prefer kana for TTS when present (clearer reading); else main Japanese line. */
export function textForTts(
  japaneseText: string,
  kana: string | null | undefined,
): string {
  const k = (kana ?? "").trim();
  if (k) return k;
  return (japaneseText ?? "").trim();
}
