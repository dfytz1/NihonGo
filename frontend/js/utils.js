import {
  LS_PLAYER,
  LS_THEME,
  LS_ACCESS_PIN,
  LS_OPENAI_MODEL,
  LS_ELEVEN_TTS_MODEL,
  getToastTimer,
  setToastTimer,
  supabase,
} from "./state.js";

export function readCfg() {
  const c = window.NIHONGO_CONFIG;
  if (!c?.SUPABASE_URL || !c?.SUPABASE_ANON_KEY) {
    throw new Error("Заполните js/config.js (URL и anon key)");
  }
  if (
    c.SUPABASE_URL.includes("YOUR_PROJECT") ||
    c.SUPABASE_ANON_KEY.includes("YOUR_")
  ) {
    throw new Error("Замените плейсхолдеры в js/config.js на данные Supabase");
  }
  return c;
}

export function getOpenAIModel() {
  return (localStorage.getItem(LS_OPENAI_MODEL) || "gpt-4o-mini").trim();
}

export function getElevenlabsModelId() {
  return (
    localStorage.getItem(LS_ELEVEN_TTS_MODEL) || "eleven_multilingual_v2"
  ).trim();
}

/** @returns {{ path: string, voice_id?: string, tts_model_id?: string, created_at?: string }[]} */
export function getAudioTracks(s) {
  if (!s) return [];
  const raw = s.audio_tracks;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .filter((t) => t && typeof t.path === "string" && String(t.path).trim())
      .map((t) => ({
        path: String(t.path).trim(),
        voice_id: t.voice_id,
        tts_model_id: t.tts_model_id,
        created_at: t.created_at,
      }));
  }
  if (s.audio_path && String(s.audio_path).trim()) {
    return [
      {
        path: String(s.audio_path).trim(),
        voice_id: s.tts_voice_id,
        tts_model_id: undefined,
        created_at: s.created_at,
      },
    ];
  }
  return [];
}

export function pickRandomAudioPath(s) {
  const paths = getAudioTracks(s).map((t) => t.path);
  if (!paths.length) return null;
  return paths[Math.floor(Math.random() * paths.length)];
}

function pinFromCookie() {
  try {
    const m = document.cookie.match(
      new RegExp(
        "(?:^|; )" +
          LS_ACCESS_PIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "=([^;]*)",
      ),
    );
    if (!m?.[1]) return "";
    return decodeURIComponent(m[1]).trim();
  } catch {
    return "";
  }
}

export function getAccessPin() {
  if (typeof localStorage !== "undefined") {
    const p = (localStorage.getItem(LS_ACCESS_PIN) || "").trim();
    if (p) return p;
  }
  if (typeof sessionStorage !== "undefined") {
    const legacy = (sessionStorage.getItem(LS_ACCESS_PIN) || "").trim();
    if (legacy) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(LS_ACCESS_PIN, legacy);
        }
      } catch {
        /* keep using session-only */
      }
      return legacy;
    }
  }
  const fromCookie = pinFromCookie();
  if (fromCookie) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LS_ACCESS_PIN, fromCookie);
      }
    } catch {
      /* */
    }
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(LS_ACCESS_PIN, fromCookie);
      }
    } catch {
      /* */
    }
    return fromCookie;
  }
  return "";
}

export function setAccessPin(pin) {
  const p = String(pin ?? "").trim();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LS_ACCESS_PIN, p);
    } catch {
      /* */
    }
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(LS_ACCESS_PIN, p);
    } catch {
      /* */
    }
  }
  try {
    const maxAge = 60 * 60 * 24 * 400;
    document.cookie = `${LS_ACCESS_PIN}=${encodeURIComponent(p)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    /* */
  }
}

export function clearAccessPin() {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(LS_ACCESS_PIN);
    } catch {
      /* */
    }
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(LS_ACCESS_PIN);
    } catch {
      /* */
    }
  }
  try {
    document.cookie = `${LS_ACCESS_PIN}=; path=/; max-age=0`;
  } catch {
    /* */
  }
}

export function loadPlayerPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LS_PLAYER) || "{}");
  } catch {
    return {};
  }
}

export function savePlayerPrefs(partial) {
  const cur = loadPlayerPrefs();
  localStorage.setItem(LS_PLAYER, JSON.stringify({ ...cur, ...partial }));
}

export function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(getToastTimer());
  setToastTimer(setTimeout(() => t.classList.add("hidden"), 3200));
}

/** Hosted Supabase Edge usually has no ffmpeg — new clips stay quiet until `npm run normalize-audio`. */
export const LOUDNORM_HINT_RU =
  "Громкость не выровнена на сервере. На компьютере, в папке проекта: npm run normalize-audio";

export function setTheme(dark) {
  document.documentElement.setAttribute(
    "data-theme",
    dark ? "dark" : "light",
  );
  localStorage.setItem(LS_THEME, dark ? "dark" : "light");
}

export function initTheme() {
  const t = localStorage.getItem(LS_THEME);
  if (t === "dark") setTheme(true);
  else if (t === "light") setTheme(false);
  else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function parseTagsInput(raw) {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function statusLabel(st) {
  const map = {
    pending: "ожидание",
    translating: "перевод",
    generating_audio: "аудио",
    ready: "готово",
    failed_translation: "ошибка перевода",
    failed_audio: "нет аудио",
    failed_storage: "хранилище",
  };
  return map[st] || st;
}

export function statusClass(st) {
  if (st === "ready") return "status-ready";
  if (st === "translating" || st === "generating_audio") {
    return "status-generating_audio";
  }
  if (String(st).startsWith("failed")) {
    return st === "failed_translation"
      ? "status-failed_translation"
      : "status-failed_audio";
  }
  return "status-pending";
}

export async function edgeFetch(fnName, body) {
  if (!supabase) throw new Error("Нет клиента");
  const pin = getAccessPin();
  if (!pin) throw new Error("Нет PIN — войдите");
  const c = readCfg();
  const payload = { ...(body ?? {}), access_pin: pin };
  let res;
  try {
    res = await fetch(`${c.SUPABASE_URL}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.SUPABASE_ANON_KEY}`,
        apikey: c.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/failed to fetch|load failed|networkerror/i.test(msg)) {
      throw new Error(
        "Сеть: запрос к Edge Function не прошёл (офлайн, блокировка или неверный SUPABASE_URL). Проверьте соединение.",
      );
    }
    throw e;
  }
  const text = await res.text();
  let out = {};
  if (text) {
    try {
      out = JSON.parse(text);
    } catch {
      out = { error: text.slice(0, 500) };
    }
  }
  return { res, payload: out };
}

export async function getAudioUrl(path) {
  if (!path || !supabase) return null;
  const { data } = supabase.storage.from("sentence-audio").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t ?? "";
  return d.innerHTML;
}

export function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
