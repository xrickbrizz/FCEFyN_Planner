(() => {
  const tabBar = document.querySelector(".mobile-bottombar");
  const moreSheet = document.querySelector(".mobile-more-sheet");
  if (!tabBar || !moreSheet) return;

  const moreToggle = tabBar.querySelector("[data-more-toggle]");
  const moreBackdrop = moreSheet.querySelector(".mobile-more-backdrop");
  const moreClose = moreSheet.querySelector("[data-more-close]");

  const setActive = (sectionId) => {
    const buttons = tabBar.querySelectorAll("[data-section]");
    buttons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.section === sectionId);
    });
    if (!tabBar.querySelector(`[data-section='${sectionId}']`)) {
      moreToggle?.classList.add("active");
    } else {
      moreToggle?.classList.remove("active");
    }
  };

  const openMore = () => {
    moreSheet.classList.add("is-open");
  };

  const closeMore = () => {
    moreSheet.classList.remove("is-open");
  };

  const navigateTo = (sectionId) => {
    if (!sectionId) return;
    if (typeof window.showTab === "function") {
      window.showTab(sectionId);
      return;
    }
    const fallback = document.querySelector(`.qs-item[data-id='${sectionId}']`);
    fallback?.click();
  };

  const handleSectionClick = (event) => {
    const target = event.target.closest("[data-section]");
    if (!target) return;
    if (!target.closest(".mobile-bottombar") && !target.closest(".mobile-topbar") && !target.closest(".mobile-more-panel")) return;
    event.preventDefault();
    const sectionId = target.dataset.section;
    navigateTo(sectionId);
    closeMore();
  };

  document.addEventListener("click", handleSectionClick);

  moreToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    openMore();
  });

  moreBackdrop?.addEventListener("click", closeMore);
  moreClose?.addEventListener("click", closeMore);

  let observer = null;

  const wrapShowTab = () => {
    if (typeof window.showTab !== "function" || window.showTab.__mobileWrapped) return;
    const original = window.showTab;
    const wrapped = function (sectionId) {
      original(sectionId);
      setActive(sectionId);
    };
    wrapped.__mobileWrapped = true;
    window.showTab = wrapped;
    observer?.disconnect();
  };

  const initActive = () => {
    const last = sessionStorage.getItem("nav:lastSection") || "inicio";
    setActive(last);
  };

  wrapShowTab();
  window.addEventListener("load", wrapShowTab);
  initActive();

  observer = new MutationObserver(() => {
    if (typeof window.showTab === "function") wrapShowTab();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
