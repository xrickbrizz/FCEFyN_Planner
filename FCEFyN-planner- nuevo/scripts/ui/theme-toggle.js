(function(){
  const STORAGE_KEY = "fcefyn-theme";
  const body = document.body;

  const ICONS = {
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 3.5v2.3M12 18.2v2.3M4.7 5.7l1.6 1.6M17.7 18.7l1.6 1.6M3.5 12h2.3M18.2 12h2.3M5.7 19.3l1.6-1.6M17.7 5.3l1.6-1.6"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.3 14.4A8.3 8.3 0 0 1 9.6 3.7a8.3 8.3 0 1 0 10.7 10.7z"/></svg>`
  };

  function ensureIconEl(btn){
    let icon = btn.querySelector(".ico");
    if (!icon){
      icon = document.createElement("span");
      icon.className = "ico";
      btn.prepend(icon);
    }
    return icon;
  }

  function updateToggleButtons(isDark){
    const iconName = isDark ? "sun" : "moon";
    const labelText = isDark ? "Activar modo claro" : "Activar modo oscuro";
    document.querySelectorAll("[data-theme-toggle]").forEach(btn =>{
      btn.setAttribute("aria-pressed", String(isDark));
      btn.setAttribute("aria-label", labelText);
      btn.setAttribute("title", labelText);
      const icon = ensureIconEl(btn);
      const label = btn.querySelector(".label");
      icon.innerHTML = ICONS[iconName];
      if (label) label.textContent = "";
    });
  }

  function applyTheme(mode, { persist = true } = {}){
    const useDark = mode === "dark";
    body.classList.toggle("dark-mode", useDark);
    body.classList.toggle("light-mode", !useDark);
    body.dataset.theme = useDark ? "dark" : "light";
    if (persist) localStorage.setItem(STORAGE_KEY, useDark ? "dark" : "light");
    updateToggleButtons(useDark);
  }

  function getPreferredTheme(){
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }

  function initThemeToggle(){
    applyTheme(getPreferredTheme());
    const buttons = document.querySelectorAll("[data-theme-toggle]");
    buttons.forEach(btn =>{
      btn.addEventListener("click", ()=>{
        const nextMode = body.classList.contains("dark-mode") ? "light" : "dark";
        applyTheme(nextMode);
      });
    });
    const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", e =>{
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) applyTheme(e.matches ? "dark" : "light");
    });
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY) return;
      const next = e.newValue === "dark" || e.newValue === "light" ? e.newValue : getPreferredTheme();
      applyTheme(next, { persist:false });
    });
  }

  document.addEventListener("DOMContentLoaded", initThemeToggle);
})();
