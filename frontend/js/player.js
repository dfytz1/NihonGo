import { filteredSentences, playable } from "./filters.js";
import { player, sentences } from "./state.js";
import {
  getAudioUrl,
  pickRandomAudioPath,
  showToast,
} from "./utils.js";

/** Two elements: while one plays, the other preloads the next URL so `play()` can run inside `ended` (iOS). */
/** @type {[HTMLAudioElement, HTMLAudioElement] | null} */
let audioPool = null;
/** Main element for one-shot `playClip` (preview / single card). */
let audioEl = null;
/** Which pool element is driving list playback, if any. */
let queueActiveEl = /** @type {HTMLAudioElement | null} */ (null);
let skipClipResolve = null;
let mediaSessionHandlersWired = false;
let playbackGeneration = 0;
let abortActiveChain = /** @type {(() => void) | null} */ (null);
let loopStatusEl = /** @type {HTMLElement | null} */ (null);
/** Filled while the last clip of a sentence plays; used to continue the sync play chain into the next sentence. */
let prefetchedSentenceBundle =
  /** @type {{ urls: string[]; meta: { title: string; artist: string; album: string }; repeatLabel: number } | null} */ (
    null
  );

function bumpPlaybackGeneration() {
  playbackGeneration++;
}

function ensurePool() {
  if (!audioPool) {
    const mk = () => {
      const a = new Audio();
      a.preload = "auto";
      a.setAttribute("playsinline", "");
      a.setAttribute("webkit-playsinline", "true");
      a.muted = false;
      a.defaultMuted = false;
      a.volume = 1;
      a.addEventListener("play", () => {
        if ("mediaSession" in navigator) {
          try {
            navigator.mediaSession.playbackState = "playing";
          } catch {
            /* */
          }
        }
      });
      a.addEventListener("pause", () => {
        if (
          "mediaSession" in navigator &&
          a &&
          !a.ended &&
          (queueActiveEl === a || (!queueActiveEl && audioEl === a))
        ) {
          try {
            navigator.mediaSession.playbackState = "paused";
          } catch {
            /* */
          }
        }
      });
      return a;
    };
    audioPool = [mk(), mk()];
    audioEl = audioPool[0];
  }
  return audioPool;
}

function getControlElement() {
  return queueActiveEl || audioEl;
}

function ensureMediaSessionHandlers() {
  if (mediaSessionHandlersWired || !("mediaSession" in navigator)) return;
  mediaSessionHandlersWired = true;
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      const el = getControlElement();
      if (el?.paused) void el.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      getControlElement()?.pause();
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
    /* */
  }
}

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
  ensurePool();
  ensureMediaSessionHandlers();
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

function pauseAndClearPool() {
  if (!audioPool) return;
  for (const a of audioPool) {
    a.pause();
    a.removeAttribute("src");
  }
}

export function playClip(
  url,
  playbackRate,
  meta = undefined,
  options = {},
) {
  wireAudio();
  const pool = ensurePool();
  const { endOnPlayFailure = true } = options;
  queueActiveEl = null;
  prefetchedSentenceBundle = null;
  pool[1].pause();
  pool[1].removeAttribute("src");
  audioEl = pool[0];

  return new Promise((resolve) => {
    skipClipResolve = resolve;
    const a = pool[0];
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

function clipMetaForSentence(s) {
  return {
    title: s.japanese_text || s.kana || "—",
    artist: "Nihon Sentences",
    album: (s.russian_text || "").slice(0, 160),
  };
}

/** @param {number} repeat */
function collectPathsForSentence(s, repeat) {
  const paths = [];
  for (let r = 0; r < repeat; r++) {
    const p = pickRandomAudioPath(s);
    if (!p) break;
    paths.push(p);
  }
  return paths;
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

/**
 * Ping-pong two Audio nodes; bridge into the next sentence via `prefetchedSentenceBundle` when pause is 0.
 */
function playUrlListChained(initialUrls, initialMeta, stEl, initialRepeatLabel, onAllDone) {
  const pool = ensurePool();
  const [el0, el1] = pool;
  const genLocal = playbackGeneration;
  const state = {
    urls: /** @type {string[]} */ (initialUrls),
    meta: initialMeta,
    repeatLabel: initialRepeatLabel,
  };
  let i = 0;
  let slot = 0;

  function rate() {
    return Number(document.getElementById("pl-speed")?.value || 1);
  }

  function updateUi() {
    if (stEl) {
      stEl.textContent =
        state.repeatLabel > 1
          ? `Играет (${i + 1}/${state.repeatLabel}, случайная дорожка)…`
          : "Играет (случайная дорожка)…";
    }
    setMediaSessionMetadata(state.meta);
  }

  function preload(standby, url) {
    if (!url) {
      standby.pause();
      standby.removeAttribute("src");
      return;
    }
    standby.pause();
    standby.src = url;
    standby.load();
  }

  function finishChain() {
    abortActiveChain = null;
    queueActiveEl = null;
    audioEl = pool[0];
  }

  function prefetchNextSentenceOnto(standby) {
    const nextIdx = player.index + 1;
    if (nextIdx >= player.queue.length) {
      preload(standby, null);
      return;
    }
    const s2 = player.queue[nextIdx];
    const rep = Number(document.getElementById("pl-repeat")?.value || 1);
    const paths = collectPathsForSentence(s2, rep);
    if (!paths.length) {
      preload(standby, null);
      return;
    }
    const g = genLocal;
    Promise.all(paths.map((p) => getAudioUrl(p))).then((nextUrls) => {
      if (g !== playbackGeneration || !player.running) return;
      if (nextUrls.some((u) => !u)) {
        prefetchedSentenceBundle = null;
        preload(standby, null);
        return;
      }
      prefetchedSentenceBundle = {
        urls: nextUrls,
        meta: clipMetaForSentence(s2),
        repeatLabel: paths.length,
      };
      preload(standby, nextUrls[0]);
    });
  }

  function wireActive(active, standby) {
    const onPlaying = () => {
      if (genLocal !== playbackGeneration || !player.running) return;
      if (state.urls[i + 1]) {
        preload(standby, state.urls[i + 1]);
      } else {
        prefetchNextSentenceOnto(standby);
      }
    };
    active.addEventListener("playing", onPlaying, { once: true });

    const onEnded = () => {
      active.removeEventListener("ended", onEnded);
      active.removeEventListener("error", onEndOrErr);
      active.removeEventListener("playing", onPlaying);
      if (genLocal !== playbackGeneration || !player.running) return;

      i += 1;
      if (i >= state.urls.length) {
        if (player.seekDelta !== 0) {
          player.index = Math.max(0, player.index + player.seekDelta);
          player.seekDelta = 0;
        } else {
          player.index++;
        }

        const pauseBetween = Number(
          document.getElementById("pl-pause")?.value || 0,
        );
        const bundle = prefetchedSentenceBundle;
        prefetchedSentenceBundle = null;

        if (
          bundle &&
          bundle.urls.length &&
          pauseBetween <= 0 &&
          player.running &&
          genLocal === playbackGeneration
        ) {
          slot = 1 - slot;
          const nextActive = pool[slot];
          const nextStandby = pool[1 - slot];
          state.urls = bundle.urls;
          state.meta = bundle.meta;
          state.repeatLabel = bundle.repeatLabel;
          i = 0;

          const sCur = player.queue[player.index];
          if (sCur) refreshNowPlaying(sCur);

          queueActiveEl = nextActive;
          audioEl = nextActive;
          updateUi();
          wireActive(nextActive, nextStandby);
          applyPlaybackRate(nextActive, rate());
          void nextActive.play().catch(() => {
            try {
              if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "paused";
              }
            } catch {
              /* */
            }
          });
          return;
        }

        finishChain();
        onAllDone();
        return;
      }

      slot = 1 - slot;
      const nextActive = pool[slot];
      const nextStandby = pool[1 - slot];

      queueActiveEl = nextActive;
      audioEl = nextActive;
      updateUi();
      wireActive(nextActive, nextStandby);
      applyPlaybackRate(nextActive, rate());
      void nextActive.play().catch(() => {
        try {
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
        } catch {
          /* */
        }
      });
    };
    const onEndOrErr = onEnded;

    active.addEventListener("ended", onEnded);
    active.addEventListener("error", onEndOrErr, { once: true });

    abortActiveChain = () => {
      active.removeEventListener("ended", onEnded);
      active.removeEventListener("error", onEndOrErr);
      active.removeEventListener("playing", onPlaying);
    };
  }

  if (!player.running) return;

  refreshNowPlaying(player.queue[player.index]);

  el0.pause();
  el1.pause();
  el1.removeAttribute("src");
  el0.src = state.urls[0];
  el0.load();

  queueActiveEl = el0;
  audioEl = el0;
  updateUi();
  wireActive(el0, el1);

  const start = () => {
    if (genLocal !== playbackGeneration || !player.running) return;
    applyPlaybackRate(el0, rate());
    void el0.play().catch(() => {
      try {
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "paused";
        }
      } catch {
        /* */
      }
    });
  };

  if (el0.readyState >= HTMLMediaElement.HAVE_METADATA) {
    start();
  } else {
    el0.addEventListener("loadedmetadata", start, { once: true });
  }
}

export function syncPlaybackRateFromUi() {
  const el = getControlElement();
  if (!el || el.paused || el.ended) return;
  const sp = Number(document.getElementById("pl-speed")?.value || 1);
  applyPlaybackRate(el, sp);
}

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
  const fn = skipClipResolve;

  bumpPlaybackGeneration();
  abortActiveChain?.();
  abortActiveChain = null;
  queueActiveEl = null;
  prefetchedSentenceBundle = null;

  pauseAndClearPool();

  skipClipResolve = null;
  if (fn) fn();

  if (player.running && !fn) {
    queueMicrotask(() => resumeQueueAfterSkip());
  }
}

export function stopPlayer() {
  player.running = false;
  player.seekDelta = 0;
  bumpPlaybackGeneration();
  abortActiveChain?.();
  abortActiveChain = null;
  queueActiveEl = null;
  prefetchedSentenceBundle = null;
  pauseAndClearPool();
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

function endPlayerLoopUi() {
  document.querySelectorAll(".sentence-card.is-playing").forEach((el) => {
    el.classList.remove("is-playing");
  });
  clearMediaSessionPlayback();
  loopStatusEl = null;
}

function finishSentenceAndContinue(genFetch) {
  if (!player.running) return;
  if (playbackGeneration !== genFetch) return;
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

  refreshNowPlaying(s);

  if (!pickRandomAudioPath(s)) {
    player.index++;
    playFromCurrentIndex();
    return;
  }

  const paths = collectPathsForSentence(s, repeat);
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
    playUrlListChained(urls, meta, stEl, paths.length, () => {
      finishSentenceAndContinue(genFetch);
    });
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !player.running) return;
    const el = getControlElement();
    if (el && el.paused && !el.ended && el.src) {
      void el.play().catch(() => {});
    }
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
