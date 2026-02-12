document.addEventListener("DOMContentLoaded", () => {
  const mountEls = document.querySelectorAll("#user-panel, #user-panel-mobile");
  if (!mountEls.length) return;

  const svgFallback = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#e6d98c"/>
          <stop offset="100%" stop-color="#9dd3ff"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="32" fill="url(#g)"/>
      <circle cx="32" cy="26" r="12" fill="rgba(255,255,255,0.9)"/>
      <path d="M14 54c3-10 14-16 18-16s15 6 18 16" fill="rgba(255,255,255,0.9)"/>
    </svg>`
  );
  const fallbackAvatar = `data:image/svg+xml;utf8,${svgFallback}`;

  const renderUserAvatar = (mountEl) => {
    mountEl.innerHTML = `
      <a class="user-avatar" href="#perfil" aria-label="Ir al perfil">
        <img src="${window.userPanelAvatar || fallbackAvatar}" alt="Foto de perfil" />
      </a>
    `;

    const avatarLink = mountEl.querySelector(".user-avatar");
    if (!avatarLink) return;

    avatarLink.addEventListener("click", (event) => {
      event.preventDefault();
      if (typeof window.showTab === "function") {
        window.showTab("perfil");
      } else {
        window.location.hash = "perfil";
      }
    });
  };

  mountEls.forEach(renderUserAvatar);

  window.addEventListener("user-panel-avatar", (event) => {
    const url = event?.detail?.url || fallbackAvatar;
    mountEls.forEach((mountEl) => {
      const avatarImg = mountEl.querySelector(".user-avatar img");
      if (avatarImg) avatarImg.src = url;
    });
  });
});
