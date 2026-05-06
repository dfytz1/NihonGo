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
/** Resolves the current `playClip` promise when the clip ends or is skipped. */
let skipClipResolve = null;
let mediaSessionHandlersWired = false;

function ensureMediaSessionHandlers() {
  if (mediaSessionHandlersWired || !("mediaSession" in navigator)) return;
  mediaSessionHandlersWired = true;
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      if (audioEl?.paused) void audioEl.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioEl?.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      playerPrev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      playerNext();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      stopPlayer();
    });
  } catch {
    /* Some platforms omit certain actions */
  }
}

/** @param {{ title?: string; artist?: string; album?: string } | null | undefined} meta */
function setMediaSessionMetadata(meta) {
  if (!("mediaSession" in navigator)) return;
  try {
    if (!meta) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
      return;
    }
    const title = (meta.title || "Nihon Sentences").slice(0, 200);
    const artist = (meta.artist || "Nihon Sentences").slice(0, 200);
    const album = (meta.album || "").slice(0, 200);
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      ...(album ? { album } : {}),
    });
    navigator.mediaSession.playbackState = "playing";
  } catch {
    /* */
  }
}

export function clearMediaSessionPlayback() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  } catch {
    /* */
  }
}

function wireAudio() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
    audioEl.setAttribute("playsinline", "");
    audioEl.setAttribute("webkit-playsinline", "true");
    audioEl.addEventListener("play", () => {
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.playbackState = "playing";
        } catch {
          /* */
        }
      }
    });
    audioEl.addEventListener("pause", () => {
      if ("mediaSession" in navigator && audioEl && !audioEl.ended) {
        try {
          navigator.mediaSession.playbackState = "paused";
        } catch {
          /* */
        }
      }
    });
  }
  ensureMediaSessionHandlers();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !player.running || !audioEl) {
      return;
    }
    if (audioEl.paused && !audioEl.ended && audioEl.src) {
      void audioEl.play().catch(() => {});
    }
  });
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
    /* Safari may throw for extreme values */
  }
}

/**
 * @param {string} url
 * @param {number} playbackRate
 * @param {{ title?: string; artist?: string; album?: string } | null} [meta] Lock screen / system UI (Media Session)
 */
export function playClip(url, playbackRate, meta = null) {
  wireAudio();
  return new Promise((resolve) => {
    skipClipResolve = resolve;
    const a = audioEl;
    const rate = Number(playbackRate) || 1;

    const finish = () => {
      skipClipResolve = null;
      resolve();
    };

    if (meta !== undefined) {
      setMediaSessionMetadata(meta);
    }

    a.onended = finish;
    a.onerror = finish;

    a.pause();
    a.src = url;

    a.addEventListener(
      "loadedmetadata",
      () => {
        applyPlaybackRate(a, rate);
        a.play().catch(finish);
      },
      { once: true },
    );
  });
}

/** While a clip is playing, apply speed from the «Скорость» control. */
export function syncPlaybackRateFromUi() {
  if (!audioEl || audioEl.paused || audioEl.ended) return;
  const sp = Number(document.getElementById("pl-speed")?.value || 1);
  applyPlaybackRate(audioEl, sp);
}

export function skipCurrentClip() {
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
  const fn = skipClipResolve;
  skipClipResolve = null;
  if (fn) fn();
}

export function stopPlayer() {
  player.running = false;
  player.seekDelta = 0;
  skipCurrentClip();
  clearMediaSessionPlayback();
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

function clipMetaForSentence(s) {
  return {
    title: s.japanese_text || s.kana || "—",
    artist: "Nihon Sentences",
    album: (s.russian_text || "").slice(0, 160),
  };
}

export async function runPlayerLoop() {
  const stEl = document.getElementById("player-status");

  const base = playable(filteredSentences());
  if (!base.length) {
    if (stEl) {
      stEl.textContent =
        "Нет записей с сохранённым аудио в текущем фильтре.";
    }
    player.running = false;
    clearMediaSessionPlayback();
    return;
  }

  let queue = [...base];
  if (document.getElementById("pl-shuffle")?.checked) {
    queue.sort(() => Math.random() - 0.5);
  }
  player.queue = queue;

  player.running = true;

  while (player.running) {
    const shuffleEl = document.getElementById("pl-shuffle");
    const repeatAll = document.getElementById("pl-repeat-all")?.checked;

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
    const repeat = Number(document.getElementById("pl-repeat")?.value || 1);

    highlightPlaying(s.id);
    const npj = document.getElementById("np-jp");
    const npk = document.getElementById("np-kana");
    const npr = document.getElementById("np-ru");
    if (npj) npj.textContent = s.japanese_text || "—";
    if (npk) npk.textContent = s.kana || "";
    if (npr) npr.textContent = s.russian_text || "";

    if (!pickRandomAudioPath(s)) {
      player.index++;
      continue;
    }

    const meta = clipMetaForSentence(s);

    for (let r = 0; r < repeat && player.running; r++) {
      const path = pickRandomAudioPath(s);
      const url = path ? await getAudioUrl(path) : null;
      if (!url) break;

      const speed = Number(document.getElementById("pl-speed")?.value || 1);
      if (stEl) {
        stEl.textContent =
          repeat > 1
            ? `Играет (${r + 1}/${repeat}, случайная дорожка)…`
            : "Играет (случайная дорожка)…";
      }
      await playClip(url, speed, meta);
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

    const pauseBetween = Number(
      document.getElementById("pl-pause")?.value || 0,
    );
    await sleep(pauseBetween);
  }

  document.querySelectorAll(".sentence-card.is-playing").forEach((el) => {
    el.classList.remove("is-playing");
  });
  clearMediaSessionPlayback();
}

export function startPlayer() {
  if (player.running) return;
  player.index = 0;
  player.seekDelta = 0;
  runPlayerLoop();
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
  await playClip(url, sp, clipMetaForSentence(s));
  clearMediaSessionPlayback();
}
