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
      try {
        localStorage.setItem(LS, pin);
      } catch (e) {
        setMsg("Не удалось сохранить PIN: " + (e && e.message));
        return;
      }
      setMsg("");
      if (input) input.value = "";
      location.reload();
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
