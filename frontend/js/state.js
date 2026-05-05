/** Shared UI state */
export const LS_VOICE = "nihongo_voice_id";
export const LS_THEME = "nihongo_theme";
export const LS_PLAYER = "nihongo_player";
/** sessionStorage — cleared when the tab/session ends */
export const SESSION_ACCESS_PIN = "nihon_access_pin";

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
export let supabase = null;

export function setSupabase(client) {
  supabase = client;
}

/** @type {any[]} */
export let sentences = [];

export function setSentences(rows) {
  sentences = rows;
}

export let selectMode = false;
export function setSelectMode(v) {
  selectMode = v;
}

/** @type {Set<string>} */
export const selected = new Set();

/** @type {{ running: boolean; queue: any[]; index: number; seekDelta: number }} */
export const player = {
  running: false,
  queue: [],
  index: 0,
  seekDelta: 0,
};

export let toastTimer = 0;
export function setToastTimer(id) {
  toastTimer = id;
}
export function getToastTimer() {
  return toastTimer;
}
