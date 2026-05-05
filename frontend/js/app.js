import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  LS_VOICE,
  selected,
  selectMode,
  sentences,
  setSelectMode,
  setSentences,
  setSupabase,
  supabase,
} from "./state.js";
import {
  playerNext,
  playerPrev,
  startPlayer,
  stopPlayer,
} from "./player.js";
import {
  initTheme,
  readCfg,
  setTheme,
  loadPlayerPrefs,
  savePlayerPrefs,
  escapeHtml,
  showToast,
  parseTagsInput,
} from "./utils.js";
import {
  bulkImport,
  exportCsv,
  exportJson,
  loadSentences,
  quickAdd,
  renderList,
  invokeBatchRegen,
  updateBatchBar,
} from "./ui.js";

function showApp() {
  document.getElementById("auth-screen")?.classList.add("hidden");
  document.getElementById("app-shell")?.classList.remove("hidden");
}

function showAuth() {
  document.getElementById("auth-screen")?.classList.remove("hidden");
  document.getElementById("app-shell")?.classList.add("hidden");
}

function setTab(tab) {
  const panels = ["add", "library", "player", "settings"];
  panels.forEach((p) => {
    document.getElementById(`panel-${p}`)?.classList.toggle("hidden", p !== tab);
  });
  document.querySelectorAll(".tab-bar [data-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-tab") === tab;
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

async function main() {
  initTheme();

  try {
    readCfg();
  } catch (e) {
    document.body.innerHTML = `<div class="auth-box"><h1>Нужна настройка</h1><p>${escapeHtml(
      String(e.message || e),
    )}</p><p class="quick-status">Скопируйте <code>js/config.example.js</code> в <code>js/config.js</code> и заполните.</p></div>`;
    return;
  }

  const c = readCfg();
  const client = createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  setSupabase(client);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const {
    data: { session },
  } = await client.auth.getSession();
  if (session) {
    showApp();
    await loadSentences();
  } else showAuth();

  client.auth.onAuthStateChange((_event, sess) => {
    if (sess) {
      showApp();
      loadSentences();
    } else {
      showAuth();
      setSentences([]);
    }
  });

  document.getElementById("btn-magic")?.addEventListener("click", async () => {
    const email = document.getElementById("email")?.value?.trim();
    const msg = document.getElementById("auth-msg");
    if (!email) {
      msg.textContent = "Введите email";
      return;
    }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    msg.textContent = error
      ? error.message
      : "Ссылка отправлена — проверьте почту";
  });

  document.getElementById("btn-signout")?.addEventListener("click", () => {
    client.auth.signOut();
  });

  document.getElementById("btn-theme")?.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") !== "dark";
    setTheme(dark);
  });

  document.getElementById("btn-add")?.addEventListener("click", quickAdd);
  document.getElementById("btn-bulk")?.addEventListener("click", bulkImport);

  [
    "search",
    "filter-tag",
    "filter-fav",
    "filter-status",
    "sort-order",
    "filter-today",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderList);
    document.getElementById(id)?.addEventListener("change", renderList);
  });

  document.getElementById("btn-select-mode")?.addEventListener("click", () => {
    setSelectMode(!selectMode);
    selected.clear();
    const b = document.getElementById("btn-select-mode");
    if (b) b.textContent = selectMode ? "Готово" : "Выбрать";
    updateBatchBar();
    renderList();
  });

  document.getElementById("btn-batch-clear")?.addEventListener("click", () => {
    selected.clear();
    renderList();
    updateBatchBar();
  });

  document.getElementById("btn-batch-audio")?.addEventListener(
    "click",
    async () => {
      const ids = [...selected].filter((id) => {
        const s = sentences.find((x) => x.id === id);
        return s && (s.japanese_text || "").trim();
      });
      if (!ids.length) {
        showToast("Выберите записи с японским текстом");
        return;
      }
      showToast("Пакетная озвучка…");
      try {
        await invokeBatchRegen(ids);
        showToast("Готово");
        await loadSentences();
      } catch (e) {
        showToast(String(e.message || e));
        await loadSentences();
      }
    },
  );

  document.getElementById("btn-batch-tags")?.addEventListener("click", async () => {
    const raw = prompt("Теги через запятую (добавятся к выбранным):");
    if (!raw) return;
    const add = parseTagsInput(raw);
    if (!add.length) return;
    await Promise.all(
      [...selected].map(async (id) => {
        const s = sentences.find((x) => x.id === id);
        if (!s) return;
        const merged = [...new Set([...(s.tags || []), ...add])];
        await supabase.from("sentences").update({ tags: merged }).eq("id", id);
      }),
    );
    selected.clear();
    await loadSentences();
    showToast("Теги добавлены");
  });

  document.getElementById("btn-export-csv")?.addEventListener("click", exportCsv);
  document.getElementById("btn-export-json")?.addEventListener("click", exportJson);

  document.querySelectorAll(".tab-bar [data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tab");
      if (t) setTab(t);
    });
  });

  const prefs = loadPlayerPrefs();
  const pmap = {
    "pl-mode": "mode",
    "pl-pause": "pause",
    "pl-silence": "silence",
    "pl-repeat": "repeat",
    "pl-speed": "speed",
  };
  Object.entries(pmap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && prefs[key] != null) el.value = String(prefs[key]);
    el?.addEventListener("change", () => {
      savePlayerPrefs({ [key]: el.value });
    });
  });
  if (typeof prefs.shuffle === "boolean") {
    const el = document.getElementById("pl-shuffle");
    if (el) el.checked = prefs.shuffle;
  }
  document.getElementById("pl-shuffle")?.addEventListener("change", (e) => {
    savePlayerPrefs({
      shuffle: /** @type {HTMLInputElement} */ (e.target).checked,
    });
  });
  if (typeof prefs.repeatAll === "boolean") {
    const el = document.getElementById("pl-repeat-all");
    if (el) el.checked = prefs.repeatAll;
  }
  document.getElementById("pl-repeat-all")?.addEventListener("change", (e) => {
    savePlayerPrefs({
      repeatAll: /** @type {HTMLInputElement} */ (e.target).checked,
    });
  });

  document.getElementById("btn-play-all")?.addEventListener("click", startPlayer);
  document.getElementById("btn-stop")?.addEventListener("click", stopPlayer);
  document.getElementById("btn-next")?.addEventListener("click", playerNext);
  document.getElementById("btn-prev")?.addEventListener("click", playerPrev);

  const vIn = document.getElementById("setting-voice");
  if (vIn) vIn.value = localStorage.getItem(LS_VOICE) || "";
  document.getElementById("btn-save-voice")?.addEventListener("click", () => {
    const v = document.getElementById("setting-voice")?.value?.trim() || "";
    localStorage.setItem(LS_VOICE, v);
    showToast("Voice ID сохранён");
  });
}

main();
