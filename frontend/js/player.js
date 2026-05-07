import { filteredSentences, playable } from "./filters.js";
import { player, sentences } from "./state.js";
import {
  getAudioUrl,
  pickRandomAudioPath,
  showToast,
  sleep,
} from "./utils.js";

/** @type {HTMLAudioElement | null} */
let audioEl = null;
let skipClipResolve = null;

function wireAudio() {
  if (!audioEl) {
    const a = new Audio();
    a.preload = "auto";
    a.setAttribute("playsinline", "");
    a.setAttribute("webkit-playsinline", "true");
    a.muted = false;
    a.defaultMuted = false;
    a.volume = 1;
    audioEl = a;
  }
}

function applyPlaybackRate(el, playbackRate) {
  const rate = Number(playbackRate);
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  try {
    el.playbackRate = r;
    if ("preservesPitch" in el) {
      /** @type {HTMLAudioElement & { preservesPitch?: boolean }} */ (el)
        .preservesPitch = true;
    }
  } catch {
    /* */
  }
}

export function playClip(
  url,
  playbackRate,
  _meta = undefined,
  options = {},
) {
  wireAudio();
  const { endOnPlayFailure = true } = options;
  return new Promise((resolve) => {
    skipClipResolve = resolve;
    const a = audioEl;
    const rate = Number(playbackRate) || 1;

    const finish = () => {
      skipClipResolve = null;
      resolve();
    };

    a.onended = finish;
    a.onerror = finish;

    a.pause();
    a.src = url;
    a.load();

    const start = () => {
      applyPlaybackRate(a, rate);
      a.play().catch(() => {
        if (endOnPlayFailure) finish();
      });
    };

    if (a.readyState >= HTMLMediaElement.HAVE_METADATA) {
      start();
    } else {
      a.addEventListener("loadedmetadata", start, { once: true });
    }
  });
}

export function skipCurrentClip() {
  const fn = skipClipResolve;
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
  skipClipResolve = null;
  if (fn) fn();
}

export function stopPlayer() {
  player.running = false;
  player.seekDelta = 0;
  skipCurrentClip();
  const stEl = document.getElementById("player-status");
  if (stEl) stEl.textContent = "";
}

export function playerNext() {
  player.seekDelta = 1;
  skipCurrentClip();
}

export function playerPrev() {
  player.seekDelta = -1;
  skipCurrentClip();
}

function highlightPlaying(id) {
  document.querySelectorAll(".sentence-card.is-playing").forEach((el) => {
    el.classList.remove("is-playing");
  });
  const card = document.getElementById(`card-${id}`);
  card?.classList.add("is-playing");
  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function refreshNowPlaying(s) {
  highlightPlaying(s.id);
  const npj = document.getElementById("np-jp");
  const npk = document.getElementById("np-kana");
  const npr = document.getElementById("np-ru");
  if (npj) npj.textContent = s.japanese_text || "—";
  if (npk) npk.textContent = s.kana || "";
  if (npr) npr.textContent = s.russian_text || "";
}

function endPlayerLoopUi() {
  document.querySelectorAll(".sentence-card.is-playing").forEach((el) => {
    el.classList.remove("is-playing");
  });
}

export function syncPlaybackRateFromUi() {
  const el = audioEl;
  if (!el || el.paused || el.ended) return;
  const sp = Number(document.getElementById("pl-speed")?.value || 1);
  applyPlaybackRate(el, sp);
}

  const stEl = document.getElementById("player-status");
  const repeat = Number(document.getElementById("pl-repeat")?.value || 1);
  const pauseBetween = Number(document.getElementById("pl-pause")?.value || 0);
  const shuffleEl = document.getElementById("pl-shuffle");
  const repeatAll = document.getElementById("pl-repeat-all")?.checked;
  const speed = Number(document.getElementById("pl-speed")?.value || 1);

  const base = playable(filteredSentences());
  if (!base.length) {
    if (stEl) {
      stEl.textContent =
        "Нет записей с сохранённым аудио в текущем фильтре.";
    }
    player.running = false;
    return;
  }

  let queue = [...base];
  if (shuffleEl?.checked) {
    queue.sort(() => Math.random() - 0.5);
  }
  player.queue = queue;

  player.running = true;

  while (player.running) {
    if (player.index < 0) player.index = 0;
    if (player.index >= player.queue.length) {
      if (!repeatAll) {
        if (stEl) stEl.textContent = "Конец списка";
        player.running = false;
        break;
      }
      player.index = 0;
      if (shuffleEl?.checked) {
        player.queue.sort(() => Math.random() - 0.5);
      }
      if (stEl) stEl.textContent = "Повтор списка";
    }

    const s = player.queue[player.index];
    refreshNowPlaying(s);

    if (!pickRandomAudioPath(s)) {
      player.index++;
      continue;
    }

    for (let r = 0; r < repeat && player.running; r++) {
      const path = pickRandomAudioPath(s);
      const url = path ? await getAudioUrl(path) : null;
      if (!url) break;

      if (stEl) {
        stEl.textContent =
          repeat > 1
            ? `Играет (${r + 1}/${repeat}, случайная дорожка)…`
            : "Играет (случайная дорожка)…";
      }
      await playClip(url, speed);
      if (!player.running) break;
      if (player.seekDelta !== 0) break;
    }

    if (!player.running) break;

    if (player.seekDelta !== 0) {
      player.index = Math.max(0, player.index + player.seekDelta);
      player.seekDelta = 0;
    } else {
      player.index++;
    }

    for (let left = pauseBetween; left > 0 && player.running; left -= 250) {
      if (player.seekDelta !== 0) break;
      await sleep(Math.min(left, 250));
    }
    if (player.seekDelta !== 0) {
      player.index = Math.max(0, player.index + player.seekDelta);
      player.seekDelta = 0;
    }
  }

  endPlayerLoopUi();
}

export function startPlayer() {
  if (player.running) return;
  player.index = 0;
  player.seekDelta = 0;
  void runPlayerLoop();
}

export async function playSingle(id) {
  const s = sentences.find((x) => x.id === id);
  if (!s) return;
  const path = pickRandomAudioPath(s);
  if (!path) return;
  stopPlayer();
  const url = await getAudioUrl(path);
  if (!url) {
    showToast("Не удалось получить ссылку на аудио");
    return;
  }
  const sp = Number(document.getElementById("pl-speed")?.value || 1);
  await playClip(url, sp);
}
