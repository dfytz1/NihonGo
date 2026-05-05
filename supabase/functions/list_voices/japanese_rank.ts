/** Heuristics on raw ElevenLabs voice objects (list / search response). */

function norm(s: string): string {
  return s.toLowerCase().trim();
}

export function verifiedLanguagesIncludeJapanese(
  v: Record<string, unknown>,
): boolean {
  const vl = v.verified_languages;
  if (!Array.isArray(vl)) return false;
  for (const item of vl) {
    if (typeof item === "string") {
      const s = norm(item);
      if (s === "ja" || s.startsWith("ja-") || s.includes("japanese")) {
        return true;
      }
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const iso = norm(String(o.iso_639_1 ?? o.language_code ?? ""));
      if (iso === "ja" || iso.startsWith("ja-")) return true;
      const nm = String(o.name ?? o.language ?? "");
      if (norm(nm).includes("japanese") || nm.includes("日本")) return true;
    }
  }
  return false;
}

function labelsOrTextSuggestJapanese(v: Record<string, unknown>): boolean {
  const labels = v.labels;
  if (labels && typeof labels === "object" && !Array.isArray(labels)) {
    for (const [k, val] of Object.entries(labels as Record<string, unknown>)) {
      const blob = `${norm(String(k))} ${norm(String(val))}`;
      if (
        blob.includes("japanese") ||
        blob.includes("japan") ||
        /\bja\b/.test(blob) ||
        blob.includes("nihongo") ||
        String(val).includes("日本") ||
        String(k).includes("日本")
      ) {
        return true;
      }
    }
  }
  const desc = String(v.description ?? "");
  if (/日本|japanese|nihongo|にほんご/i.test(desc)) return true;
  const name = String(v.name ?? "");
  if (/日本|japanese|nihongo/i.test(name)) return true;
  return false;
}

/** Strong signal: verified JP or explicit Japanese metadata. */
export function isRecommendedForJapanese(v: Record<string, unknown>): boolean {
  if (verifiedLanguagesIncludeJapanese(v)) return true;
  if (labelsOrTextSuggestJapanese(v)) return true;
  return false;
}

/** Voice ships with multilingual / v2.5 family IDs — often usable for Japanese with your TTS model. */
export function hasMultilingualFamilyModel(v: Record<string, unknown>): boolean {
  const models = v.high_quality_base_model_ids;
  if (!Array.isArray(models)) return false;
  for (const m of models) {
    const s = norm(String(m));
    if (
      s.includes("multilingual") ||
      s.includes("eleven_flash") ||
      s.includes("eleven_turbo") ||
      s.includes("turbo_v2") ||
      s.includes("flash_v2") ||
      s.includes("v2_5")
    ) {
      return true;
    }
  }
  return false;
}
