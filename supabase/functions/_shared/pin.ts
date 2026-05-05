import { jsonResponse } from "./cors.ts";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ta = enc.encode(a);
  const tb = enc.encode(b);
  if (ta.length !== tb.length) return false;
  let v = 0;
  for (let i = 0; i < ta.length; i++) v |= ta[i] ^ tb[i];
  return v === 0;
}

/** Returns a JSON Response if PIN is missing/wrong; otherwise null. */
export function requireAccessPin(req: Request): Response | null {
  const secret = (Deno.env.get("ACCESS_PIN") ?? "").trim();
  if (!secret || secret.length < 4) {
    return jsonResponse(
      { error: "Set ACCESS_PIN secret (min 4 characters) on Edge Functions" },
      500,
    );
  }
  const provided = (req.headers.get("x-access-pin") ?? "").trim();
  if (!timingSafeEqual(provided, secret)) {
    return jsonResponse({ error: "Неверный PIN" }, 401);
  }
  return null;
}
