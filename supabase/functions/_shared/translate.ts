// OpenAI Chat Completions — API key from Edge Function secrets only (OPENAI_API_KEY).

const SYSTEM = `You translate Russian phrases into natural, everyday spoken Japanese — the kind a fluent person would actually say in casual conversation, not stiff literal textbook Japanese.
Prefer short, natural sentences. If the Russian is ambiguous, choose the most common real-life interpretation.
Respond with a single JSON object only, no markdown, with keys:
- "japanese" — the main Japanese line (kanji/kana mix as naturally written)
- "kana" — full reading in hiragana (or mixed kana) for the same line, for study purposes
Do not include romaji.`;

export type TranslationResult = {
  japanese: string;
  kana: string;
  model: string;
};

export async function translateRussianToJapanese(
  russianText: string,
  modelOverride?: string,
): Promise<TranslationResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not configured on the server");

  const trimmed = modelOverride?.trim();
  const model =
    trimmed ||
    Deno.env.get("OPENAI_MODEL")?.trim() ||
    "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: russianText.trim() },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }

  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  const parsed = JSON.parse(content) as { japanese?: string; kana?: string };
  const japanese = (parsed.japanese ?? "").trim();
  const kana = (parsed.kana ?? "").trim();
  if (!japanese) throw new Error("Translation produced empty Japanese");

  return { japanese, kana, model };
}
