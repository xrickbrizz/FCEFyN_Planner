(function () {
  function normalizeFormElementTitle(el) {
    if (!el || !el.getAttribute) return;
    const t = el.getAttribute("title");
    if (!t) return;
    if (!el.getAttribute("aria-label")) {
      el.setAttribute("aria-label", t);
    }
    el.removeAttribute("title");
  }

  function disableFormTooltips() {
    const selector = "input[title], textarea[title], select[title], option[title], label[title]";

    document.querySelectorAll(selector).forEach((el) => {
      normalizeFormElementTitle(el);
    });

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.target?.matches?.(selector)) {
          normalizeFormElementTitle(mutation.target);
          return;
        }

        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches(selector)) {
            normalizeFormElementTitle(node);
          }
          node.querySelectorAll?.(selector).forEach((el) => {
            normalizeFormElementTitle(el);
          });
        });
      });
    });

    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["title"]
      });
    }
  }

  window.disableFormTooltips = disableFormTooltips;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", disableFormTooltips, { once: true });
  } else {
    disableFormTooltips();
  }
})();
