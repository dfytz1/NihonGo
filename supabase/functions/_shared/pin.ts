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

function pinFromBody(parsed: Record<string, unknown> | null | undefined): string {
  if (!parsed || typeof parsed !== "object") return "";
  const a = parsed["access_pin"];
  const b = parsed["pin"];
  const s = typeof a === "string" ? a : typeof b === "string" ? b : "";
  return s.trim();
}

/**
 * PIN may be sent as header `X-Access-Pin` or JSON field `access_pin` (or `pin`).
 * Prefer body for browser CORS: custom headers expand preflight and some gateways mis-handle Allow-Headers.
 */
export function requireAccessPin(
  req: Request,
  parsedBody?: Record<string, unknown> | null,
): Response | null {
  const secret = (Deno.env.get("ACCESS_PIN") ?? "").trim();
  if (!secret || secret.length < 4) {
    return jsonResponse(
      { error: "Set ACCESS_PIN secret (min 4 characters) on Edge Functions" },
      500,
    );
  }
  const fromHeader = (req.headers.get("x-access-pin") ?? "").trim();
  const fromBody = pinFromBody(parsedBody);
  const provided = fromHeader || fromBody;
  if (!timingSafeEqual(provided, secret)) {
    return jsonResponse({ error: "Неверный PIN" }, 401);
  }
  return null;
}
