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
    audioEl = new Audio();
    audioEl.preload = "auto";
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
    /* Safari may throw for extreme values */
  }
}

export function playClip(url, playbackRate) {
  wireAudio();
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

export async function runPlayerLoop() {
  const stEl = document.getElementById("player-status");

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

    const pauseBetween = Number(
      document.getElementById("pl-pause")?.value || 0,
    );
    await sleep(pauseBetween);
  }

  document.querySelectorAll(".sentence-card.is-playing").forEach((el) => {
    el.classList.remove("is-playing");
  });
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
  await playClip(url, sp);
}
