import { filteredSentences, playable } from "./filters.js";
import { player, sentences } from "./state.js";
import {
  getAudioUrl,
  pickRandomAudioPath,
  showToast,
} from "./utils.js";

/** @type {HTMLAudioElement | null} */
let audioEl = null;
/** Resolves the current `playClip` promise when the clip ends or is skipped. */
let skipClipResolve = null;
let mediaSessionHandlersWired = false;
/** Bumped on skip/stop so in-flight «chain» callbacks exit without advancing. */
let playbackGeneration = 0;
/** Removes `ended`/`error` listeners from the active queue chain. */
let abortActiveChain = /** @type {(() => void) | null} */ (null);
/** Status line element for the queue driver (set when list playback starts). */
let loopStatusEl = /** @type {HTMLElement | null} */ (null);

function bumpPlaybackGeneration() {
  playbackGeneration++;
}

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
 * One-off clip (card preview, single-card play). Optional `meta`; omit to leave Media Session unchanged.
 * @param {{ endOnPlayFailure?: boolean }} [options] If `endOnPlayFailure` is false, a rejected `play()` does not resolve early (queue-style).
 */
export function playClip(
  url,
  playbackRate,
  meta = undefined,
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

    if (meta !== undefined) {
      setMediaSessionMetadata(meta);
    }

    a.onended = finish;
    a.onerror = finish;

    a.pause();
    a.src = url;
    a.load();

    const start = () => {
      applyPlaybackRate(a, rate);
      a.play().catch(() => {
        try {
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
        } catch {
          /* */
        }
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

/** Chained clips for lock screen / background: next `src` + `play()` from `ended` synchronously (iOS-friendly). */
function playUrlListChained(
  urls,
  idx,
  meta,
  stEl,
  repeatLabel,
  onAllDone,
) {
  wireAudio();
  const a = audioEl;
  if (!player.running) return;

  if (idx >= urls.length) {
    abortActiveChain = null;
    onAllDone();
    return;
  }

  const gen = playbackGeneration;
  const url = urls[idx];
  const rate = Number(document.getElementById("pl-speed")?.value || 1);

  if (stEl) {
    stEl.textContent =
      repeatLabel > 1
        ? `Играет (${idx + 1}/${repeatLabel}, случайная дорожка)…`
        : "Играет (случайная дорожка)…";
  }

  setMediaSessionMetadata(meta);

  const onEnded = () => {
    a.removeEventListener("ended", onEnded);
    a.removeEventListener("error", onError);
    if (gen !== playbackGeneration || !player.running) return;
    playUrlListChained(urls, idx + 1, meta, stEl, repeatLabel, onAllDone);
  };
  const onError = onEnded;

  a.addEventListener("ended", onEnded);
  a.addEventListener("error", onError, { once: true });

  abortActiveChain = () => {
    a.removeEventListener("ended", onEnded);
    a.removeEventListener("error", onError);
  };

  const start = () => {
    if (gen !== playbackGeneration || !player.running) return;
    applyPlaybackRate(a, rate);
    void a.play().catch(() => {
      try {
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "paused";
        }
      } catch {
        /* */
      }
    });
  };

  a.pause();
  a.src = url;
  a.load();
  if (a.readyState >= HTMLMediaElement.HAVE_METADATA) {
    start();
  } else {
    a.addEventListener("loadedmetadata", start, { once: true });
  }
}

/** While a clip is playing, apply speed from the «Скорость» control. */
export function syncPlaybackRateFromUi() {
  if (!audioEl || audioEl.paused || audioEl.ended) return;
  const sp = Number(document.getElementById("pl-speed")?.value || 1);
  applyPlaybackRate(audioEl, sp);
}

/** After a chained skip, continue the queue from the updated index. */
function resumeQueueAfterSkip() {
  if (!player.running) return;
  if (player.seekDelta !== 0) {
    player.index = Math.max(0, player.index + player.seekDelta);
    player.seekDelta = 0;
  } else {
    player.index++;
  }
  playFromCurrentIndex();
}

export function skipCurrentClip() {
  const hadChain = !!abortActiveChain;
  const fn = skipClipResolve;

  bumpPlaybackGeneration();
  abortActiveChain?.();
  abortActiveChain = null;

  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }

  skipClipResolve = null;
  if (fn) fn();

  if (player.running && hadChain && !fn) {
    queueMicrotask(() => resumeQueueAfterSkip());
  }
}

export function stopPlayer() {
  player.running = false;
  player.seekDelta = 0;
  bumpPlaybackGeneration();
  abortActiveChain?.();
  abortActiveChain = null;
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
  const fn = skipClipResolve;
  skipClipResolve = null;
  if (fn) fn();
  clearMediaSessionPlayback();
  loopStatusEl = null;
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

function endPlayerLoopUi() {
  document.querySelectorAll(".sentence-card.is-playing").forEach((el) => {
    el.classList.remove("is-playing");
  });
  clearMediaSessionPlayback();
  loopStatusEl = null;
}

function playFromCurrentIndex() {
  const stEl = loopStatusEl;
  if (!player.running) {
    endPlayerLoopUi();
    return;
  }

  const shuffleEl = document.getElementById("pl-shuffle");
  const repeatAll = document.getElementById("pl-repeat-all")?.checked;

  if (player.index < 0) player.index = 0;
  if (player.index >= player.queue.length) {
    if (!repeatAll) {
      if (stEl) stEl.textContent = "Конец списка";
      player.running = false;
      endPlayerLoopUi();
      return;
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
    playFromCurrentIndex();
    return;
  }

  const paths = [];
  for (let r = 0; r < repeat; r++) {
    const p = pickRandomAudioPath(s);
    if (!p) break;
    paths.push(p);
  }
  if (!paths.length) {
    player.index++;
    playFromCurrentIndex();
    return;
  }

  const genFetch = playbackGeneration;
  Promise.all(paths.map((p) => getAudioUrl(p))).then((urls) => {
    if (!player.running || playbackGeneration !== genFetch) return;
    if (urls.some((u) => !u)) {
      player.index++;
      playFromCurrentIndex();
      return;
    }
    const meta = clipMetaForSentence(s);
    playUrlListChained(
      urls,
      0,
      meta,
      stEl,
      paths.length,
      () => {
        if (!player.running) return;
        if (playbackGeneration !== genFetch) return;
        if (player.seekDelta !== 0) {
          player.index = Math.max(0, player.index + player.seekDelta);
          player.seekDelta = 0;
        } else {
          player.index++;
        }
        const pauseBetween = Number(
          document.getElementById("pl-pause")?.value || 0,
        );
        if (pauseBetween <= 0) {
          playFromCurrentIndex();
        } else {
          setTimeout(() => {
            if (player.running && playbackGeneration === genFetch) {
              playFromCurrentIndex();
            }
          }, pauseBetween);
        }
      },
    );
  });
}

export function runPlayerLoop() {
  const stEl = document.getElementById("player-status");

  const base = playable(filteredSentences());
  if (!base.length) {
    if (stEl) {
      stEl.textContent =
        "Нет записей с сохранённым аудио в текущем фильтре.";
    }
    player.running = false;
    clearMediaSessionPlayback();
    loopStatusEl = null;
    return;
  }

  let queue = [...base];
  if (document.getElementById("pl-shuffle")?.checked) {
    queue.sort(() => Math.random() - 0.5);
  }
  player.queue = queue;

  player.running = true;
  loopStatusEl = stEl;
  playFromCurrentIndex();
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
