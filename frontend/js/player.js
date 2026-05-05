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

export function playClip(url, playbackRate) {
  wireAudio();
  return new Promise((resolve) => {
    skipClipResolve = resolve;
    const a = audioEl;
    a.playbackRate = playbackRate;
    a.src = url;
    a.onended = () => {
      skipClipResolve = null;
      resolve();
    };
    a.onerror = () => {
      skipClipResolve = null;
      resolve();
    };
    a.play().catch(() => {
      skipClipResolve = null;
      resolve();
    });
  });
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
  const repeat = Number(document.getElementById("pl-repeat")?.value || 1);
  const pauseBetween = Number(document.getElementById("pl-pause")?.value || 0);
  const silenceAfter = Number(
    document.getElementById("pl-silence")?.value || 0,
  );
  const mode = document.getElementById("pl-mode")?.value || "japanese_only";
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

      if (stEl) {
        stEl.textContent =
          repeat > 1
            ? `Играет (${r + 1}/${repeat}, случайная дорожка)…`
            : "Играет (случайная дорожка)…";
      }
      await playClip(url, speed);
      if (!player.running) break;
      if (player.seekDelta !== 0) break;

      if (mode === "japanese_silence" && silenceAfter > 0) {
        await sleep(silenceAfter);
      }

      if (mode === "japanese_russian") {
        const ov = document.getElementById("russian-overlay");
        if (ov) {
          ov.textContent = s.russian_text || "";
          ov.classList.remove("hidden");
        }
        await sleep(Math.max(silenceAfter, 1800));
        document.getElementById("russian-overlay")?.classList.add("hidden");
      }
    }

    if (!player.running) break;

    if (player.seekDelta !== 0) {
      player.index = Math.max(0, player.index + player.seekDelta);
      player.seekDelta = 0;
    } else {
      player.index++;
    }

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
