import { createQuickSidebar } from "../ui/sidebar.js";

const iconSvg = (paths) => `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    ${paths}
  </svg>
`;

const navIcons = {
  home: iconSvg(`<path d="M3 11.5 12 4l9 7.5v8a2 2 0 0 1-2 2h-5v-6H10v6H5a2 2 0 0 1-2-2z"/>`),
  study: iconSvg(`<path d="M4 6.5c2.4-.6 4.8-.6 7.2.2v13c-2.4-.8-4.8-.8-7.2-.2z"/><path d="M20 6.5c-2.4-.6-4.8-.6-7.2.2v13c2.4-.8 4.8-.8 7.2-.2z"/>`),
  academic: iconSvg(`<path d="M3 8l9-4 9 4-9 4z"/><path d="M7 12.5v4c0 1.7 2.7 3 5 3s5-1.3 5-3v-4"/><path d="M21 10.5v4"/>`),
  calendar: iconSvg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 9h18"/>`),
  layers: iconSvg(`<path d="M12 3 4 7l8 4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/>`),
  route: iconSvg(`<path d="M5 6a2 2 0 1 0 0 4h8a2 2 0 1 1 0 4H9"/><path d="M5 18h.01"/><path d="M19 6h.01"/>`),
  sliders: iconSvg(`<path d="M4 6h8"/><path d="M16 6h4"/><path d="M10 6v4"/><path d="M4 14h4"/><path d="M12 14h8"/><path d="M14 14v4"/>`),
  users: iconSvg(`<path d="M16 11a3 3 0 1 0-6 0"/><path d="M4 20a6 6 0 0 1 16 0"/><path d="M8 11a4 4 0 0 1 8 0"/>`)
};

export const navItems = [
  { id:"inicio", label:"Inicio", icon:navIcons.home },
  { id:"estudio", label:"Estudio", icon:navIcons.study },
  { id:"academico", label:"Académico", icon:navIcons.academic },
  { id:"agenda", label:"Agenda", icon:navIcons.calendar },
  { id:"materias", label:"Materias", icon:navIcons.layers },
  { id:"planestudios", label:"Plan de estudios", icon:navIcons.route },
  { id:"planificador", label:"Planificador", icon:navIcons.sliders },
  { id:"profesores", label:"Profesores", icon:navIcons.users },
  //{ id:"mensajes", label:"Mensajes", icon:"" },
  //{ id:"perfil", label:"Perfil", icon:"" },
];

console.log("[nav] loaded");

export function initNav(ctx = {}) {
  console.log("[nav] init start", ctx);
  try {
    const mountId = ctx.mountId || "quickSidebarMount";
    const toggleId = ctx.toggleId || "sidebarToggle";
    const layoutId = ctx.layoutId || "pageLayout";
    const items = Array.isArray(ctx.items) && ctx.items.length ? ctx.items : navItems;
    const showTab = ctx.showTab;

    const mount = document.getElementById(mountId);
    console.log("[nav] sidebar container found?", !!mount);
    if (!mount) return null;

    items.forEach(item => {
      console.log("[nav] binding click", item.id);
    });

    const toggleBtn = document.getElementById(toggleId);
    const layout = document.getElementById(layoutId);
    let isPinned = false;

    const isMobile = () =>
      window.matchMedia && window.matchMedia("(max-width: 1024px)").matches;

    const sidebarCtrl = createQuickSidebar({
      mount,
      items,
      title: ctx.title || null,
      subtitle: ctx.subtitle || null,
      //footer: ctx.footer ,
      collapsed: ctx.collapsed ?? true,
      onSelect: id => {
        console.log("[nav] click -> section", id);
        if (typeof showTab === "function") {
          console.log("[nav] showTab called", id);
          showTab(id);
        }
        if (!isPinned && !isMobile()) collapseSidebar();
      }
    });

    function collapseSidebar() {
      if (!sidebarCtrl || isMobile()) return;
      sidebarCtrl.setCollapsed(true);
      layout?.classList.add("sidebar-collapsed");
    }

    function expandSidebar() {
      if (!sidebarCtrl) return;
      sidebarCtrl.setCollapsed(false);
      layout?.classList.remove("sidebar-collapsed");
    }

    if (layout && sidebarCtrl) {
      sidebarCtrl.setCollapsed(true);
      layout.classList.add("sidebar-collapsed");
    }

    mount.addEventListener("mouseenter", () => {
      if (!isMobile()) expandSidebar();
    });
    mount.addEventListener("mouseleave", () => {
      if (!isMobile() && !isPinned) collapseSidebar();
    });

    if (toggleBtn && sidebarCtrl) {
      toggleBtn.addEventListener("click", () => {
        if (isMobile()) {
          sidebarCtrl.toggle();
          return;
        }
        isPinned = !isPinned;
        toggleBtn.classList.toggle("active", isPinned);
        if (isPinned) expandSidebar();
        else collapseSidebar();
      });
    }

    if (ctx.activeSection) sidebarCtrl.setActive(ctx.activeSection);
    collapseSidebar();
    console.log("[nav] init done");
    return sidebarCtrl;
  } catch (e) {
    console.error("[nav] error", e);
    return null;
  }
}
