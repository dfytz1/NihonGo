import {
  LS_VOICE,
  LS_PLAYER,
  LS_THEME,
  SESSION_ACCESS_PIN,
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

export function getVoiceId() {
  return (localStorage.getItem(LS_VOICE) || "").trim();
}

export function getAccessPin() {
  return (
    (typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SESSION_ACCESS_PIN)) ||
    ""
  ).trim();
}

export function setAccessPin(pin) {
  const p = String(pin ?? "").trim();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(SESSION_ACCESS_PIN, p);
  }
}

export function clearAccessPin() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(SESSION_ACCESS_PIN);
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
  const res = await fetch(`${c.SUPABASE_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.SUPABASE_ANON_KEY}`,
      apikey: c.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      "X-Access-Pin": pin,
    },
    body: JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await res.json();
  } catch {
    /* ignore */
  }
  return { res, payload };
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
