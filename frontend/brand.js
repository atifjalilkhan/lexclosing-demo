/**
 * brand.js — pulls firm name/tagline/colors from GET /api/config and
 * applies them to the page. This is what lets the exact same HTML/CSS/JS
 * serve any law firm: the only thing that changes per firm is
 * backend/firm-config.js (or its env vars), never these files.
 *
 * Every page ships with real RWHM text as a static fallback, so if this
 * fetch fails for any reason the page still reads correctly — it just
 * won't reflect an env-var override.
 */
(function () {
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      document.querySelectorAll('[data-firm-name]').forEach((el) => {
        el.textContent = cfg.firmName;
      });
      document.querySelectorAll('[data-firm-tagline]').forEach((el) => {
        el.textContent = cfg.tagline;
      });
      if (document.title) {
        document.title = document.title.replace(/RWHM|Rusk, Wadlin, Heppner & Martuscello, LLP/, cfg.firmShortName);
      }
      if (cfg.colors) {
        const root = document.documentElement.style;
        if (cfg.colors.primary) root.setProperty('--pine', cfg.colors.primary);
        if (cfg.colors.accent) root.setProperty('--brass', cfg.colors.accent);
        if (cfg.colors.background) root.setProperty('--cream', cfg.colors.background);
      }
    })
    .catch(() => {
      // Config fetch failed — the static fallback text/colors already in
      // the HTML stay as-is.
    });
})();
