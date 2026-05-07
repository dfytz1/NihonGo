import { filteredSentences } from "./filters.js";
import {
  playClip,
  playSingle,
} from "./player.js";
import {
  selected,
  selectMode,
  sentences,
  setSentences,
  supabase,
} from "./state.js";
import {
  buildTtsVoiceBody,
  setVoiceCatalog,
  voiceLabel,
} from "./voices.js";
import {
  edgeFetch,
  escapeHtml,
  formatDate,
  getAccessPin,
  getAudioUrl,
  getOpenAIModel,
  getElevenlabsModelId,
  getAudioTracks,
  parseTagsInput,
  showToast,
  sleep,
  statusClass,
  statusLabel,
} from "./utils.js";

let voicesCatalogPrimed = false;

export function refreshTagFilterOptions() {
  const sel = document.getElementById("filter-tag");
  if (!sel) return;
  const cur = sel.value;
  const tags = new Set();
  sentences.forEach((s) => (s.tags || []).forEach((t) => tags.add(t)));
  const sorted = [...tags].sort();
  sel.innerHTML = '<option value="">Все теги</option>';
  sorted.forEach((t) => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    sel.appendChild(o);
  });
  if ([...tags].includes(cur)) sel.value = cur;
  refreshAddPanelTagPicker();
}

export function refreshAddPanelTagPicker() {
  const host = document.getElementById("tag-picker-existing");
  if (!host) return;
  const tags = new Set();
  sentences.forEach((s) => (s.tags || []).forEach((t) => tags.add(t)));
  const sorted = [...tags].sort();
  const checked = new Set(
    [...host.querySelectorAll("input[data-tag]:checked")].map((el) =>
      el.getAttribute("data-tag"),
    ),
  );
  host.innerHTML = "";
  if (!sorted.length) {
    host.innerHTML =
      '<p class="quick-status" style="margin:0">Пока нет тегов — введите новые ниже или добавьте записи с тегами.</p>';
    return;
  }
  for (const t of sorted) {
    const row = document.createElement("label");
    row.className = "select-wrap";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.tag = t;
    cb.checked = checked.has(t);
    row.appendChild(cb);
    row.appendChild(document.createTextNode(` ${t}`));
    host.appendChild(row);
  }
}

function collectQuickTags() {
  const fromInput = parseTagsInput(
    document.getElementById("quick-tags")?.value || "",
  );
  const fromCb = [];
  document
    .querySelectorAll("#tag-picker-existing input[data-tag]:checked")
    .forEach((el) => {
      const t = el.getAttribute("data-tag");
      if (t) fromCb.push(t);
    });
  return [...new Set([...fromCb, ...fromInput])];
}

export function updateBatchBar() {
  const bar = document.getElementById("batch-bar");
  const cnt = document.getElementById("batch-count");
  if (!selectMode) {
    bar?.classList.add("hidden");
    return;
  }
  bar?.classList.remove("hidden");
  if (cnt) cnt.textContent = String(selected.size);
}

export function renderList() {
  const root = document.getElementById("sentence-list");
  if (!root) return;
  const list = filteredSentences();
  root.innerHTML = "";

  if (!list.length) {
    root.innerHTML =
      '<p class="quick-status">Пока пусто или ничего не подошло под фильтр.</p>';
    return;
  }

  for (const s of list) {
    const card = document.createElement("article");
    card.className = "sentence-card";
    card.id = `card-${s.id}`;
    card.dataset.id = s.id;

    const cb = selectMode
      ? `<label class="select-wrap"><input type="checkbox" data-select="${
        s.id
      }" ${selected.has(s.id) ? "checked" : ""}/><span class="sr-only">Выбрать</span></label>`
      : "";

    const favStar = s.favorite ? "★" : "☆";
    const tracks = getAudioTracks(s);
    const nTracks = tracks.length;
    const canPlay = nTracks > 0;
    const canTts = (s.japanese_text || "").trim().length > 0;
    card.innerHTML = `
      ${cb ? `<div class="row" style="margin-bottom:0.5rem">${cb}</div>` : ""}
      <p class="ru">${escapeHtml(s.russian_text)}</p>
      <p class="jp">${escapeHtml(s.japanese_text || "—")}</p>
      ${s.kana ? `<p class="kana">${escapeHtml(s.kana)}</p>` : ""}
      <div class="meta">
        <span class="status-pill ${statusClass(s.status)}">${escapeHtml(
          statusLabel(s.status),
        )}</span>
        ${nTracks ? `<span class="tag-chip" title="Число озвучек">♪×${nTracks}</span>` : ""}
        <span>${formatDate(s.created_at)}</span>
        ${
          (s.tags || [])
            .map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`)
            .join("")
        }
      </div>
      ${
        s.error_message
          ? `<p class="quick-status err-detail" style="margin:0.45rem 0 0">${escapeHtml(s.error_message)}</p>`
          : ""
      }
      <div class="card-actions">
        <button type="button" class="btn btn-secondary btn-play-one" data-id="${s.id}" ${
          !canPlay ? "disabled" : ""
        }>▶</button>
        <button type="button" class="btn btn-secondary btn-fav" data-id="${s.id}">${favStar}</button>
        <button type="button" class="btn btn-secondary btn-edit" data-id="${s.id}">Правка</button>
        ${
          canTts
            ? `<button type="button" class="btn btn-secondary btn-add-track" data-id="${s.id}">+Озвучка</button>`
            : ""
        }
        ${
          s.status === "failed_audio" || s.status === "failed_storage"
            ? `<button type="button" class="btn btn-primary btn-retry-tts" data-id="${s.id}">Озвучка снова</button>`
            : ""
        }
        <button type="button" class="btn btn-danger btn-del" data-id="${s.id}">Удалить</button>
      </div>
    `;
    root.appendChild(card);
  }

  root.querySelectorAll("[data-select]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const id = /** @type {HTMLInputElement} */ (e.target).dataset.select;
      if (!id) return;
      if (/** @type {HTMLInputElement} */ (e.target).checked) selected.add(id);
      else selected.delete(id);
      updateBatchBar();
    });
  });

  root.querySelectorAll(".btn-play-one").forEach((b) => {
    b.addEventListener("click", () => playSingle(b.getAttribute("data-id")));
  });
  root.querySelectorAll(".btn-fav").forEach((b) => {
    b.addEventListener("click", () => toggleFav(b.getAttribute("data-id")));
  });
  root.querySelectorAll(".btn-edit").forEach((b) => {
    b.addEventListener("click", () => openEdit(b.getAttribute("data-id")));
  });
  root.querySelectorAll(".btn-retry-tts").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      if (!id) return;
      try {
        showToast("Генерация аудио…");
        await invokeRegen(id);
        await loadSentences();
        showToast("Готово");
      } catch (e) {
        showToast(String(e.message || e));
        await loadSentences();
      }
    });
  });
  root.querySelectorAll(".btn-add-track").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-id");
      if (!id) return;
      try {
        showToast("Новая дорожка…");
        await invokeRegen(id);
        await loadSentences();
        showToast("Готово");
      } catch (e) {
        showToast(String(e.message || e));
        await loadSentences();
      }
    });
  });
  root.querySelectorAll(".btn-del").forEach((b) => {
    b.addEventListener("click", () => delSentence(b.getAttribute("data-id")));
  });
}

export async function loadSentences() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("sentences")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    showToast(error.message);
    return;
  }
  setSentences(data || []);
  if (getAccessPin() && !voicesCatalogPrimed) {
    voicesCatalogPrimed = true;
    void edgeFetch("list_voices", {}).then(({ res, payload }) => {
      if (res.ok && payload.voices?.length) {
        setVoiceCatalog(payload.voices);
      } else {
        voicesCatalogPrimed = false;
      }
    });
  }
  refreshTagFilterOptions();
  renderList();
}

export async function deleteAudioTrack(sentenceId, pathToRemove) {
  if (!pathToRemove || !supabase) return;
  const s = sentences.find((x) => x.id === sentenceId);
  if (!s) return;
  const tracks = getAudioTracks(s).filter((t) => t.path !== pathToRemove);
  await supabase.storage.from("sentence-audio").remove([pathToRemove]);
  const patch = {
    audio_tracks: tracks,
    audio_path: tracks.length ? tracks[tracks.length - 1].path : null,
    status: tracks.length ? "ready" : "failed_audio",
    error_message: null,
  };
  const { error } = await supabase
    .from("sentences")
    .update(patch)
    .eq("id", sentenceId);
  if (error) showToast(error.message);
  else await loadSentences();
}

export async function toggleFav(id) {
  const s = sentences.find((x) => x.id === id);
  if (!s || !supabase) return;
  const { error } = await supabase
    .from("sentences")
    .update({ favorite: !s.favorite })
    .eq("id", id);
  if (error) showToast(error.message);
  else await loadSentences();
}

export async function delSentence(id) {
  if (!confirm("Удалить эту запись?")) return;
  const s = sentences.find((x) => x.id === id);
  if (!s || !supabase) return;
  const paths = getAudioTracks(s).map((t) => t.path);
  if (paths.length) {
    await supabase.storage.from("sentence-audio").remove(paths);
  }
  const { error } = await supabase.from("sentences").delete().eq("id", id);
  if (error) showToast(error.message);
  else {
    selected.delete(id);
    await loadSentences();
  }
}

function edgeErrorMessage(payload, res) {
  const e = payload?.error;
  if (typeof e === "string" && e.trim()) return e.trim();
  if (payload?.message && typeof payload.message === "string") {
    return payload.message;
  }
  const hint = payload?.hint;
  if (typeof hint === "string" && hint) {
    const base = typeof e === "string" ? e : res.statusText;
    return `${base} (${hint})`;
  }
  if (e && typeof e === "object") {
    try {
      return JSON.stringify(e);
    } catch {
      return res.statusText;
    }
  }
  return res.statusText || "Ошибка сервера";
}

export async function invokeRegen(id) {
  const body = {
    sentence_id: id,
    elevenlabs_model_id: getElevenlabsModelId(),
    ...buildTtsVoiceBody(),
  };
  const { res, payload } = await edgeFetch("regenerate_audio", body);
  if (!res.ok) throw new Error(edgeErrorMessage(payload, res));
  return payload;
}

export async function invokeBatchRegen(ids) {
  let remaining = [...ids];
  const elevenlabs_model_id = getElevenlabsModelId();
  const voicePart = buildTtsVoiceBody();
  /** @type {Record<string, unknown>|null} */
  let lastPayload = null;
  while (remaining.length) {
    const body = { sentence_ids: remaining, elevenlabs_model_id, ...voicePart };
    const { res, payload } = await edgeFetch("batch_regenerate_audio", body);
    if (!res.ok) throw new Error(payload.error || res.statusText);
    lastPayload = payload;
    remaining = payload.remainder_ids || [];
    if (!remaining.length) break;
  }
  return lastPayload;
}

export function openEdit(id) {
  const s = sentences.find((x) => x.id === id);
  if (!s) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  const h = document.createElement("h2");
  h.textContent = "Правка";
  modal.appendChild(h);

  const mkArea = (label, val, id) => {
    const lb = document.createElement("label");
    lb.className = "label";
    lb.htmlFor = id;
    lb.textContent = label;
    modal.appendChild(lb);
    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.id = id;
    ta.value = val;
    modal.appendChild(ta);
    return ta;
  };

  const mkInput = (label, val, id) => {
    const lb = document.createElement("label");
    lb.className = "label";
    lb.htmlFor = id;
    lb.textContent = label;
    modal.appendChild(lb);
    const inp = document.createElement("input");
    inp.className = "input";
    inp.id = id;
    inp.value = val;
    modal.appendChild(inp);
    return inp;
  };

  mkArea("Русский", s.russian_text || "", "edit-ru");
  mkArea("Японский", s.japanese_text || "", "edit-jp");
  mkInput("Кана", s.kana || "", "edit-kana");
  mkInput("Теги (через запятую)", (s.tags || []).join(", "), "edit-tags");

  const tracks = getAudioTracks(s);
  if (tracks.length) {
    const h3 = document.createElement("h3");
    h3.style.fontSize = "0.95rem";
    h3.style.marginTop = "0.75rem";
    h3.textContent = "Озвучки (удалить ненужные)";
    modal.appendChild(h3);
    const listEl = document.createElement("div");
    listEl.style.display = "flex";
    listEl.style.flexDirection = "column";
    listEl.style.gap = "0.35rem";
    tracks.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.alignItems = "center";
      row.style.flexWrap = "wrap";
      row.style.gap = "0.35rem";
      const meta = document.createElement("span");
      meta.style.fontSize = "0.8rem";
      meta.style.color = "var(--muted)";
      meta.style.flex = "1";
      meta.style.minWidth = "min(100%, 200px)";
      meta.title = t.path;
      const vname = voiceLabel(t.voice_id);
      const created = t.created_at ? formatDate(t.created_at) : "";
      meta.textContent = `#${i + 1} · ${vname}${
        t.tts_model_id ? ` · ${String(t.tts_model_id).slice(0, 18)}` : ""
      }${created ? ` · ${created}` : ""}`;
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn-secondary";
      playBtn.textContent = "▶";
      playBtn.title = "Прослушать";
      playBtn.addEventListener("click", async () => {
        const url = await getAudioUrl(t.path);
        if (!url) {
          showToast("Нет ссылки на файл");
          return;
        }
        const sp = Number(document.getElementById("pl-speed")?.value || 1);
        await playClip(url, sp);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger";
      del.textContent = "Удалить";
      del.addEventListener("click", async () => {
        if (!confirm("Удалить эту дорожку из хранилища?")) return;
        await deleteAudioTrack(id, t.path);
        close();
      });
      row.appendChild(meta);
      row.appendChild(playBtn);
      row.appendChild(del);
      listEl.appendChild(row);
    });
    modal.appendChild(listEl);
  }

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const btnSave = document.createElement("button");
  btnSave.type = "button";
  btnSave.className = "btn btn-primary";
  btnSave.textContent = "Сохранить";

  const btnRegen = document.createElement("button");
  btnRegen.type = "button";
  btnRegen.className = "btn btn-secondary";
  btnRegen.textContent = "Перегенерировать аудио";

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "btn btn-secondary";
  btnClose.textContent = "Закрыть";

  actions.append(btnSave, btnRegen, btnClose);
  modal.appendChild(actions);
  backdrop.appendChild(modal);

  const close = () => backdrop.remove();

  btnClose.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  btnSave.addEventListener("click", async () => {
    const ru = modal.querySelector("#edit-ru")?.value?.trim() || "";
    const jp = modal.querySelector("#edit-jp")?.value?.trim() || "";
    const kana = modal.querySelector("#edit-kana")?.value?.trim() || "";
    const tags = parseTagsInput(modal.querySelector("#edit-tags")?.value || "");
    const { error } = await supabase
      .from("sentences")
      .update({
        russian_text: ru,
        japanese_text: jp,
        kana: kana || null,
        tags,
      })
      .eq("id", id);
    if (error) showToast(error.message);
    else {
      showToast("Сохранено");
      await loadSentences();
    }
  });

  btnRegen.addEventListener("click", async () => {
    btnSave.click();
    try {
      showToast("Генерация аудио…");
      await invokeRegen(id);
      await loadSentences();
      showToast("Аудио обновлено");
    } catch (e) {
      showToast(String(e.message || e));
      await loadSentences();
    }
  });

  document.getElementById("modal-root")?.appendChild(backdrop);
}

export async function quickAdd() {
  const ta = document.getElementById("quick-ru");
  const st = document.getElementById("quick-status");
  const raw = ta?.value?.trim() || "";
  const tags = collectQuickTags();

  if (!raw) {
    showToast("Введите текст");
    return;
  }

  st.textContent = "Перевод и аудио…";

  const body = {
    russian_text: raw,
    tags,
    skip_duplicate_check: false,
    openai_model: getOpenAIModel(),
    elevenlabs_model_id: getElevenlabsModelId(),
    ...buildTtsVoiceBody(),
  };

  try {
    let { res, payload } = await edgeFetch("add_sentence", body);
    if (res.status === 409) {
      if (
        !confirm("Такая русская фраза уже есть. Добавить ещё раз?")
      ) {
        st.textContent = "Отменено";
        return;
      }
      body.skip_duplicate_check = true;
      ({ res, payload } = await edgeFetch("add_sentence", body));
    }

    if (!res.ok) {
      st.textContent = "Ошибка: " + (payload.error || res.statusText);
      await loadSentences();
      return;
    }

    const s = payload.sentence;
    const looksDone =
      s &&
      (s.status === "ready" ||
        (((s.japanese_text ?? "") + "").trim() &&
          (((Array.isArray(s.audio_tracks) && s.audio_tracks.length) ||
            (s.audio_path ?? "").toString().trim()))));

    if (looksDone) {
      st.textContent = "Сохранено";
    } else if (payload.success === false && payload.error === "translation") {
      st.textContent = "Ошибка перевода (запись сохранена)";
    } else if (payload.warning) {
      const det = payload.sentence?.error_message;
      st.textContent = det
        ? `${payload.warning}\n${det}`
        : payload.warning;
    } else {
      st.textContent = "Сохранено";
    }

    ta.value = "";
    ta.focus();
    await loadSentences();
  } catch (e) {
    st.textContent = "Ошибка: " + String(e.message || e);
  }
}

export async function bulkImport() {
  const box = document.getElementById("bulk-text");
  const st = document.getElementById("bulk-status");
  const lines = (box?.value || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tags = collectQuickTags();
  if (!lines.length) {
    st.textContent = "Нет строк";
    return;
  }
  const voicePart = buildTtsVoiceBody();
  st.textContent = `Импорт 0/${lines.length}…`;
  let i = 0;
  for (const line of lines) {
    i++;
    st.textContent = `Импорт ${i}/${lines.length}…`;
    const body = {
      russian_text: line,
      tags,
      skip_duplicate_check: true,
      openai_model: getOpenAIModel(),
      elevenlabs_model_id: getElevenlabsModelId(),
      ...voicePart,
    };
    try {
      const { res, payload } = await edgeFetch("add_sentence", body);
      if (!res.ok) console.warn(payload);
    } catch (e) {
      console.warn(e);
    }
    await sleep(400);
  }
  st.textContent = "Импорт завершён";
  box.value = "";
  await loadSentences();
}

export function exportCsv() {
  const rows = filteredSentences();
  const cols = [
    "id",
    "russian_text",
    "japanese_text",
    "kana",
    "tags",
    "status",
    "favorite",
    "audio_paths",
    "created_at",
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    cols.join(","),
    ...rows.map((s) =>
      cols
        .map((c) =>
          esc(
            c === "tags"
              ? (s.tags || []).join(";")
              : c === "audio_paths"
              ? getAudioTracks(s).map((t) => t.path).join("|")
              : s[c],
          ),
        )
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nihon-sentences.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportJson() {
  const rows = filteredSentences();
  const blob = new Blob([JSON.stringify(rows, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nihon-sentences.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
