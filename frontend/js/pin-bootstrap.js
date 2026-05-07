/**
 * Classic (non-module) PIN login — runs even when `app.js` fails to load (CDN / iOS quirks).
 * Keep `__nihongoTabPin` in sync with `TAB_PIN_KEY` in `utils.js`.
 *
 * After verify, `handoffToApp` waits for `globalThis.__nihongoAppReady` so listeners exist before `showApp()`.
 * Never reveal #app-shell early — that produced a clickable-looking but inert UI.
 */
(function () {
  var LS = "nihon_access_pin";
  /** Guard double-submit; cold Edge Function can take 30s+ */
  var pinSubmitting = false;
  var VERIFY_TIMEOUT_MS = 60000;

  function setMsg(text) {
    var el = document.getElementById("auth-msg");
    if (el) el.textContent = text || "";
    else if (text) window.alert(text);
  }

  /** @returns {boolean} true if at least one persistence path likely worked */
  function persistPin(pin) {
    var ok = false;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(LS, pin);
        if (localStorage.getItem(LS) === pin) ok = true;
      } catch (_e) {
        /* */
      }
    }
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem(LS, pin);
        if (sessionStorage.getItem(LS) === pin) ok = true;
      } catch (_e) {
        /* */
      }
    }
    try {
      var sec =
        typeof location !== "undefined" && location.protocol === "https:"
          ? "; Secure"
          : "";
      document.cookie =
        LS +
        "=" +
        encodeURIComponent(pin) +
        "; path=/; max-age=" +
        60 * 60 * 24 * 400 +
        "; SameSite=Lax" +
        sec;
      ok = true;
    } catch (_e) {
      /* */
    }
    return ok;
  }

  function handoffToApp(verifiedPin) {
    return new Promise(function (resolve) {
      function run() {
        if (typeof globalThis.__nihongoAfterPinOk !== "function") return false;
        if (!globalThis.__nihongoAppReady) return false;
        try {
          return globalThis.__nihongoAfterPinOk(verifiedPin) === true;
        } catch (e) {
          setMsg((e && e.message) || String(e));
          return true;
        }
      }
      if (run()) {
        resolve(true);
        return;
      }
      var n = 0;
      var id = setInterval(function () {
        n += 1;
        if (run()) {
          clearInterval(id);
          resolve(true);
        } else if (n >= 400) {
          clearInterval(id);
          setMsg(
            "Интерфейс не загрузился за 20 с. Проверьте блокировщики и сеть; откройте консоль (F12). Обновите страницу вручную.",
          );
          resolve(false);
        }
      }, 50);
    });
  }

  async function submitPin() {
    var cfg = window.NIHONGO_CONFIG;
    if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      setMsg("Нет конфигурации (js/config.js).");
      return;
    }
    if (pinSubmitting) return;
    var input = document.getElementById("access-pin");
    var pin = input && input.value ? String(input.value).trim() : "";
    if (pin.length < 4) {
      setMsg("Введите PIN (минимум 4 символа)");
      return;
    }
    var btn = document.getElementById("btn-pin-login");
    pinSubmitting = true;
    if (btn) {
      btn.disabled = true;
      btn.dataset.prevLabel = btn.textContent || "";
      btn.textContent = "Проверка…";
    }
    setMsg("Запрос к серверу… (первый вход может занять до минуты)");
    var ac = new AbortController();
    var to = setTimeout(function () {
      ac.abort();
    }, VERIFY_TIMEOUT_MS);
    try {
      var base = String(cfg.SUPABASE_URL || "").replace(/\/+$/, "");
      var r = await fetch(base + "/functions/v1/verify_pin", {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY,
          apikey: cfg.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ access_pin: pin }),
      });
      var rawText = "";
      try {
        rawText = await r.text();
      } catch (readErr) {
        setMsg(
          "Не удалось прочитать ответ сервера: " +
            ((readErr && readErr.message) || String(readErr)),
        );
        return;
      }
      /** @type {Record<string, unknown>} */
      var payload = {};
      if (rawText && rawText.trim()) {
        try {
          payload = /** @type {Record<string, unknown>} */ (
            JSON.parse(rawText)
          );
        } catch (_parse) {
          payload = {};
        }
      }
      if (!r.ok) {
        var part0 = payload.error || payload.detail;
        var err0 =
          (typeof part0 === "string" && part0) ||
          ("Ошибка " + r.status + (rawText ? ": " + rawText.slice(0, 200) : ""));
        setMsg(err0);
        return;
      }
      var okResp =
        payload &&
        (payload.ok === true ||
          payload.ok === 1 ||
          String(payload.ok).toLowerCase() === "true");
      if (!okResp) {
        var part = payload.error || payload.detail;
        var err =
          (typeof part === "string" && part) ||
          "Сервер не подтвердил вход. Ответ: " +
            (rawText ? rawText.slice(0, 280) : "(пусто)") +
            ". Обновите страницу.";
        setMsg(err);
        return;
      }
      try {
        globalThis.__nihongoTabPin = pin;
      } catch (_e) {
        /* */
      }
      if (!persistPin(pin)) {
        try {
          delete globalThis.__nihongoTabPin;
        } catch (_e2) {
          /* */
        }
        setMsg("Не удалось сохранить PIN в этом браузере.");
        return;
      }
      setMsg("Подключаем приложение…");
      if (input) input.value = "";
      var handoffOk = await handoffToApp(pin);
      if (!handoffOk) {
        try {
          delete globalThis.__nihongoTabPin;
        } catch (_cl) {
          /* */
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError") {
        setMsg(
          "Таймаут: за " +
            Math.round(VERIFY_TIMEOUT_MS / 1000) +
            " с нет ответа от Supabase. Проверьте интернет, URL проекта и что функция verify_pin включена. Повторите попытку.",
        );
      } else {
        setMsg((e && e.message) || String(e));
      }
    } finally {
      clearTimeout(to);
      pinSubmitting = false;
      if (btn) {
        btn.disabled = false;
        if (btn.dataset.prevLabel != null) {
          btn.textContent = btn.dataset.prevLabel;
          delete btn.dataset.prevLabel;
        }
      }
    }
  }

  function wire() {
    var btn = document.getElementById("btn-pin-login");
    var inp = document.getElementById("access-pin");
    if (btn && !btn.dataset.nihongoPinBound) {
      btn.dataset.nihongoPinBound = "1";
      btn.addEventListener("click", function () {
        void submitPin();
      });
    }
    if (inp && !inp.dataset.nihongoPinBound) {
      inp.dataset.nihongoPinBound = "1";
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") void submitPin();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
