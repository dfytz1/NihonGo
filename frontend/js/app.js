import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  LS_OPENAI_MODEL,
  LS_ELEVEN_TTS_MODEL,
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
  syncPlaybackRateFromUi,
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
  clearAccessPin,
  getAccessPin,
  setAccessPin,
  edgeFetch,
  LOUDNORM_HINT_RU,
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
import { getSelectedVoiceIds, setSelectedVoiceIds, setVoiceCatalog } from "./voices.js";

const OPENAI_MODEL_CHOICES = [
  ["gpt-4o-mini", "gpt-4o-mini"],
  ["gpt-4o", "gpt-4o"],
  ["gpt-4.1-mini", "gpt-4.1-mini"],
  ["gpt-4.1", "gpt-4.1"],
];

const ELEVEN_MODEL_CHOICES = [
  ["eleven_multilingual_v2", "Multilingual v2"],
  ["eleven_turbo_v2_5", "Turbo v2.5"],
  ["eleven_flash_v2_5", "Flash v2.5"],
  ["eleven_v3", "v3 (если доступна в аккаунте)"],
];

function formatUsagePayload(payload) {
  const lines = [];
  const e = payload.elevenlabs;
  if (e && typeof e === "object") {
    if (e.error) {
      lines.push(`ElevenLabs: ${e.error}${e.detail ? " — " + e.detail : ""}`);
    } else {
      const used =
        e.character_count ?? e.character_count_used ?? e.usage ?? null;
      const lim = e.character_limit ?? e.max_chars ?? null;
      const tier = e.tier ?? "";
      if (typeof used === "number" && typeof lim === "number") {
        lines.push(
          `ElevenLabs${tier ? ` (${tier})` : ""}: символы ${used} / ${lim}`,
        );
      } else {
        lines.push(`ElevenLabs: ${JSON.stringify(e).slice(0, 400)}`);
      }
    }
  }
  return lines.join("\n") || "Нет данных";
}

/** @type {HTMLAudioElement | null} */
let voicePreviewAudio = null;
let voicePreviewObjectUrl = /** @type {string | null} */ (null);

async function playJapaneseVoiceSample(voiceId) {
  if (!voiceId || !getAccessPin()) return;
  try {
    voicePreviewAudio?.pause();
    if (voicePreviewObjectUrl) {
      URL.revokeObjectURL(voicePreviewObjectUrl);
      voicePreviewObjectUrl = null;
    }
    const cfg = readCfg();
    const model = (
      document.getElementById("setting-eleven-model")?.value || ""
    ).trim();
    const r = await fetch(
      `${cfg.SUPABASE_URL}/functions/v1/voice_preview_japanese`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
          apikey: cfg.SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          access_pin: getAccessPin(),
          voice_id: voiceId,
          ...(model ? { elevenlabs_model_id: model } : {}),
        }),
      },
    );
    if (!r.ok) {
      let msg = r.statusText;
      try {
        const j = await r.json();
        if (j.error) msg = String(j.error);
      } catch {
        const t = await r.text();
        if (t) msg = t.slice(0, 240);
      }
      showToast(msg);
      return;
    }
    const blob = await r.blob();
    voicePreviewObjectUrl = URL.createObjectURL(blob);
    voicePreviewAudio = new Audio(voicePreviewObjectUrl);
    voicePreviewAudio.addEventListener(
      "ended",
      () => {
        if (voicePreviewObjectUrl) {
          URL.revokeObjectURL(voicePreviewObjectUrl);
          voicePreviewObjectUrl = null;
        }
      },
      { once: true },
    );
    await voicePreviewAudio.play();
  } catch (e) {
    showToast(String(e?.message || e));
  }
}

function appendVoiceSettingRow(host, v, saved) {
  const id = v.voice_id;
  const wrap = document.createElement("div");
  wrap.className = "voice-setting-row row";

  const lab = document.createElement("label");
  lab.className = "select-wrap";
  lab.style.flex = "1";
  lab.style.minWidth = "min(100%, 220px)";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.value = id;
  cb.checked = saved.has(id);
  lab.appendChild(cb);

  const nameSpan = document.createElement("span");
  nameSpan.appendChild(document.createTextNode(` ${v.name || id}`));
  if (v.good_for_japanese) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.style.marginLeft = "0.35rem";
    chip.textContent = "яп.";
    chip.title = "Помечено ElevenLabs как подходящее для японского";
    nameSpan.appendChild(chip);
  } else if (v.multilingual_eligible) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.style.marginLeft = "0.35rem";
    chip.textContent = "ML";
    chip.title = "Мультиязычная / v2.5 — обычно можно озвучивать японский";
    nameSpan.appendChild(chip);
  }
  lab.appendChild(nameSpan);
  wrap.appendChild(lab);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  btn.textContent = "▶";
  btn.title = "Японский образец (как в озвучке)";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void playJapaneseVoiceSample(id);
  });
  wrap.appendChild(btn);

  host.appendChild(wrap);
}

async function loadVoicesIntoSettings() {
  const host = document.getElementById("voice-checkboxes");
  const st = document.getElementById("voice-load-status");
  if (!host || !getAccessPin()) return;
  if (st) st.textContent = "Загрузка голосов…";
  try {
    const { res, payload } = await edgeFetch("list_voices", {});
    if (!res.ok) {
      throw new Error(
        [payload?.error, payload?.detail].filter(Boolean).join(" — ") ||
          res.statusText,
      );
    }
    const voices = payload.voices || [];
    setVoiceCatalog(voices);
    const saved = new Set(getSelectedVoiceIds());
    host.innerHTML = "";
    let lastTier = -1;
    let sectionIndex = 0;
    for (const v of voices) {
      const tier = v.good_for_japanese
        ? 0
        : v.multilingual_eligible
          ? 1
          : 2;
      if (tier !== lastTier) {
        lastTier = tier;
        const h = document.createElement("p");
        h.className = "label";
        h.style.marginTop = sectionIndex++ === 0 ? "0" : "0.85rem";
        h.textContent =
          tier === 0
            ? "Рекомендуемы для японского"
            : tier === 1
              ? "Мультиязычные (часто подходят для японского)"
              : "Остальные голоса";
        host.appendChild(h);
      }
      appendVoiceSettingRow(host, v, saved);
    }
    if (st) {
      st.textContent = voices.length
        ? `Отметьте голоса (в списке до ${voices.length}).`
        : "Нет голосов в ответе API";
    }
  } catch (e) {
    if (st) st.textContent = String(e.message || e);
  }
}

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
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  setSupabase(client);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (getAccessPin()) {
    showApp();
  } else {
    showAuth();
  }

  async function loginWithPin() {
    const pin = document.getElementById("access-pin")?.value?.trim() ?? "";
    const msg = document.getElementById("auth-msg");
    const setAuthMsg = (t) => {
      if (msg) msg.textContent = t;
      else if (t) showToast(t);
    };
    if (pin.length < 4) {
      setAuthMsg("Введите PIN (минимум 4 символа)");
      return;
    }
    setAuthMsg("Проверка…");
    try {
      const r = await fetch(`${c.SUPABASE_URL}/functions/v1/verify_pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.SUPABASE_ANON_KEY}`,
          apikey: c.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ access_pin: pin }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok || payload.ok !== true) {
        setAuthMsg(
          [payload.error, payload.detail]
            .filter(Boolean)
            .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
            .join(" — ") || `Ошибка ${r.status}`,
        );
        return;
      }
      setAccessPin(pin);
      setAuthMsg("");
      const pinEl = document.getElementById("access-pin");
      if (pinEl) pinEl.value = "";
      showApp();
      await loadSentences();
    } catch (e) {
      setAuthMsg(String(e.message || e));
    }
  }

  document.getElementById("btn-pin-login")?.addEventListener("click", loginWithPin);
  document.getElementById("access-pin")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") loginWithPin();
  });

  document.getElementById("btn-signout")?.addEventListener("click", () => {
    clearAccessPin();
    setSentences([]);
    showAuth();
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
    "sort-order",
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
        const batchPayload = await invokeBatchRegen(ids);
        if (batchPayload?.loudnorm_skipped_any) {
          showToast(`Готово. ${LOUDNORM_HINT_RU}`);
        } else {
          showToast("Готово");
        }
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
      if (t) {
        setTab(t);
        if (t === "settings") loadVoicesIntoSettings();
      }
    });
  });

  const prefs = loadPlayerPrefs();
  const pmap = {
    "pl-pause": "pause",
    "pl-repeat": "repeat",
  };
  Object.entries(pmap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && prefs[key] != null) el.value = String(prefs[key]);
    el?.addEventListener("change", () => {
      savePlayerPrefs({ [key]: el.value });
    });
  });
  const plSpeed = document.getElementById("pl-speed");
  if (plSpeed && prefs.speed != null) plSpeed.value = String(prefs.speed);
  plSpeed?.addEventListener("input", () => syncPlaybackRateFromUi());
  plSpeed?.addEventListener("change", () => {
    syncPlaybackRateFromUi();
    savePlayerPrefs({
      speed: /** @type {HTMLSelectElement} */ (plSpeed).value,
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
  document.getElementById("pl-repeat-all")?.addEventListener("change", (
    e,
  ) => {
    savePlayerPrefs({
      repeatAll: /** @type {HTMLInputElement} */ (e.target).checked,
    });
  });

  document.getElementById("btn-play-all")?.addEventListener("click", startPlayer);
  document.getElementById("btn-stop")?.addEventListener("click", stopPlayer);
  document.getElementById("btn-next")?.addEventListener("click", playerNext);
  document.getElementById("btn-prev")?.addEventListener("click", playerPrev);

  const oSel = document.getElementById("setting-openai-model");
  if (oSel) {
    oSel.innerHTML = "";
    for (const [v, label] of OPENAI_MODEL_CHOICES) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      oSel.appendChild(o);
    }
    oSel.value =
      localStorage.getItem(LS_OPENAI_MODEL) || OPENAI_MODEL_CHOICES[0][0];
  }
  const elSel = document.getElementById("setting-eleven-model");
  if (elSel) {
    elSel.innerHTML = "";
    for (const [v, label] of ELEVEN_MODEL_CHOICES) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      elSel.appendChild(o);
    }
    elSel.value =
      localStorage.getItem(LS_ELEVEN_TTS_MODEL) ||
      ELEVEN_MODEL_CHOICES[0][0];
  }

  document.getElementById("btn-save-voice")?.addEventListener("click", () => {
    const picked = [];
    document
      .querySelectorAll("#voice-checkboxes input[type=checkbox]:checked")
      .forEach((el) => {
        const v = /** @type {HTMLInputElement} */ (el).value?.trim();
        if (v) picked.push(v);
      });
    setSelectedVoiceIds(picked);
    localStorage.setItem(
      LS_OPENAI_MODEL,
      document.getElementById("setting-openai-model")?.value ||
        OPENAI_MODEL_CHOICES[0][0],
    );
    localStorage.setItem(
      LS_ELEVEN_TTS_MODEL,
      document.getElementById("setting-eleven-model")?.value ||
        ELEVEN_MODEL_CHOICES[0][0],
    );
    showToast("Настройки сохранены");
  });

  document.getElementById("btn-refresh-usage")?.addEventListener(
    "click",
    async () => {
      const el = document.getElementById("usage-info");
      if (el) el.textContent = "Загрузка…";
      try {
        const { res, payload } = await edgeFetch("usage_snapshot", {});
        if (!res.ok) {
          throw new Error(
            [payload?.error, payload?.detail].filter(Boolean).join(" — ") ||
              res.statusText,
          );
        }
        if (el) el.textContent = formatUsagePayload(payload);
      } catch (e) {
        if (el) el.textContent = String(e.message || e);
      }
    },
  );

  if (getAccessPin()) {
    void loadSentences();
  }
}

main();
