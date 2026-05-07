/**
 * Classic (non-module) PIN login — runs even when `app.js` fails to load (CDN / iOS quirks).
 * Keep `__nihongoTabPin` in sync with `TAB_PIN_KEY` in `utils.js`.
 *
 * Do not toggle #app-shell visible here: if the module fails, users would see a dead UI (no listeners).
 * After verify, `__nihongoAfterPinOk(pin)` hands off to app.js in the same document so login works
 * even when `reload()` would not see storage (iOS / PWA). Reload is only a last-resort fallback.
 */
(function () {
  var LS = "nihon_access_pin";

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

  /** Prefer in-process handoff with verified PIN; avoid reload until app module is ready. */
  function handoffToApp(verifiedPin) {
    function run() {
      if (typeof globalThis.__nihongoAfterPinOk !== "function") return false;
      try {
        return globalThis.__nihongoAfterPinOk(verifiedPin) === true;
      } catch (e) {
        setMsg((e && e.message) || String(e));
        return true;
      }
    }
    if (run()) return;
    var n = 0;
    var id = setInterval(function () {
      n += 1;
      if (run()) {
        clearInterval(id);
      } else if (n >= 100) {
        clearInterval(id);
        location.reload();
      }
    }, 50);
  }

  async function submitPin() {
    var cfg = window.NIHONGO_CONFIG;
    if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      setMsg("Нет конфигурации (js/config.js).");
      return;
    }
    var input = document.getElementById("access-pin");
    var pin = input && input.value ? String(input.value).trim() : "";
    if (pin.length < 4) {
      setMsg("Введите PIN (минимум 4 символа)");
      return;
    }
    setMsg("Проверка…");
    try {
      var r = await fetch(cfg.SUPABASE_URL + "/functions/v1/verify_pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY,
          apikey: cfg.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ access_pin: pin }),
      });
      /** @type {Record<string, unknown>} */
      var payload = {};
      try {
        payload = /** @type {Record<string, unknown>} */ (await r.json());
      } catch (_e) {
        /* */
      }
      if (!r.ok) {
        var part0 = payload.error || payload.detail;
        var err0 =
          (typeof part0 === "string" && part0) ||
          ("Ошибка " + r.status);
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
          "Сервер не подтвердил вход. Обновите страницу.";
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
        } catch (_e) {
          /* */
        }
        setMsg("Не удалось сохранить PIN в этом браузере.");
        return;
      }
      setMsg("");
      if (input) input.value = "";
      handoffToApp(pin);
    } catch (e) {
      setMsg((e && e.message) || String(e));
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
