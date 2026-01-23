import { createQuickSidebar } from "../ui/sidebar.js";

const iconSvg = {
  inicio: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 10l9-7 9 7"></path>
      <path d="M9 22V12h6v10"></path>
    </svg>
  `,
  estudio: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"></path>
      <path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"></path>
      <path d="M12 8v12"></path>
    </svg>
  `,
  academico: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 10L12 4 2 10l10 6 10-6z"></path>
      <path d="M6 12v5c0 2 2.7 3.5 6 3.5s6-1.5 6-3.5v-5"></path>
      <path d="M18 11.5V16"></path>
    </svg>
  `,
  agenda: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2"></rect>
      <path d="M8 3v4"></path>
      <path d="M16 3v4"></path>
      <path d="M3 10h18"></path>
      <circle cx="8" cy="14" r="1"></circle>
      <circle cx="12" cy="14" r="1"></circle>
      <circle cx="16" cy="14" r="1"></circle>
    </svg>
  `,
  materias: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2l9 5-9 5-9-5 9-5z"></path>
      <path d="M3 12l9 5 9-5"></path>
      <path d="M3 17l9 5 9-5"></path>
    </svg>
  `,
  planestudios: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6l7-3 8 3 7-3v15l-7 3-8-3-7 3z"></path>
      <path d="M10 3v15"></path>
      <path d="M18 6v15"></path>
    </svg>
  `,
  planificador: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6"></line>
      <line x1="4" y1="12" x2="20" y2="12"></line>
      <line x1="4" y1="18" x2="20" y2="18"></line>
      <circle cx="9" cy="6" r="2"></circle>
      <circle cx="15" cy="12" r="2"></circle>
      <circle cx="7" cy="18" r="2"></circle>
    </svg>
  `,
  profesores: `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="8.5" cy="7" r="3.5"></circle>
      <path d="M20 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a3.5 3.5 0 0 1 0 6.75"></path>
    </svg>
  `
};

export const navItems = [
  { id:"inicio", label:"Inicio", icon: iconSvg.inicio },
  { id:"estudio", label:"Estudio", icon: iconSvg.estudio },
  { id:"academico", label:"Académico", icon: iconSvg.academico },
  { id:"agenda", label:"Agenda", icon: iconSvg.agenda },
  { id:"materias", label:"Materias", icon: iconSvg.materias },
  { id:"planestudios", label:"Plan de estudios", icon: iconSvg.planestudios },
  { id:"planificador", label:"Planificador", icon: iconSvg.planificador },
  { id:"profesores", label:"Profesores", icon: iconSvg.profesores },
  //{ id:"mensajes", label:"Mensajes", icon:"💬" },
  //{ id:"perfil", label:"Perfil", icon:"👤" },
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
