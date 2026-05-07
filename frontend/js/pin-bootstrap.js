/**
 * Classic (non-module) PIN login — runs even when `app.js` fails to load (CDN / iOS quirks).
 * Must match `LS_ACCESS_PIN` in state.js ("nihon_access_pin").
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
      document.cookie =
        LS +
        "=" +
        encodeURIComponent(pin) +
        "; path=/; max-age=" +
        60 * 60 * 24 * 400 +
        "; SameSite=Lax";
      ok = true;
    } catch (_e) {
      /* */
    }
    return ok;
  }

  /** @returns {string} trimmed pin if any store has a plausible value */
  function readStoredPin() {
    try {
      var a = (localStorage.getItem(LS) || "").trim();
      if (a.length >= 4) return a;
    } catch (_e) {
      /* */
    }
    try {
      var b = (sessionStorage.getItem(LS) || "").trim();
      if (b.length >= 4) return b;
    } catch (_e) {
      /* */
    }
    try {
      var esc = LS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var m = document.cookie.match(
        new RegExp("(?:^|; )" + esc + "=([^;]*)"),
      );
      if (m && m[1]) {
        var c = decodeURIComponent(m[1]).trim();
        if (c.length >= 4) return c;
      }
    } catch (_e) {
      /* */
    }
    return "";
  }

  /** Show the main shell immediately when a PIN is already stored (before deferred app.js). */
  function revealAppIfLoggedIn() {
    if (!readStoredPin()) return;
    var auth = document.getElementById("auth-screen");
    var app = document.getElementById("app-shell");
    if (auth) auth.classList.add("hidden");
    if (app) app.classList.remove("hidden");
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
      if (!r.ok || payload.ok !== true) {
        var part = payload.error || payload.detail;
        var err =
          (typeof part === "string" && part) ||
          ("Ошибка " + r.status);
        setMsg(err);
        return;
      }
      if (!persistPin(pin)) {
        setMsg("Не удалось сохранить PIN в этом браузере.");
        return;
      }
      setMsg("");
      if (input) input.value = "";
      setTimeout(function () {
        location.reload();
      }, 100);
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

  function init() {
    revealAppIfLoggedIn();
    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
